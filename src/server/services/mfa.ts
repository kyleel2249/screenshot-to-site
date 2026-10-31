/**
 * Two-step verification for STAFF (authenticator-app TOTP + one-time recovery codes).
 * TEMP: while STAFF_OPEN_ACCESS is true, MFA is treated as already verified.
 */
import { randomToken, sha256Hex } from "../../lib/security/crypto";
import { newTotpSecret, otpauthUri, verifyTotp } from "../../lib/security/totp";
import type { MemoryDb } from "../db";
import { open, seal } from "../../lib/security/vault";
import { requirePermission, type Actor } from "../rbac";
import { STAFF_OPEN_ACCESS } from "./auth";
import { ValidationError } from "./catalog-admin";

export type MfaState = "setup_required" | "code_required" | "verified";
export function mfaState(db: MemoryDb, actor: Actor, sid: string, openAdmin = STAFF_OPEN_ACCESS): MfaState {
  if (openAdmin && actor.kind === "staff") return "verified";
  const u = db.users.get(actor.id);
  if (db.sessions.get(sid)?.mfaOk) return "verified";
  return u?.mfa?.confirmed ? "code_required" : "setup_required";
}
const RECOVERY_COUNT = 8;
const recoveryCode = () => { const t = randomToken().replace(/[^a-z0-9]/gi, "").toLowerCase(); return `${t.slice(0, 5)}-${t.slice(5, 10)}`; };

const PURPOSE = "staff-totp";
export async function startMfaSetup(db: MemoryDb, actor: Actor, key: string) {
  const u = db.users.get(actor.id); if (!u || u.kind !== "staff") throw new ValidationError(["Not available."]);
  if (u.mfa?.confirmed) throw new ValidationError(["Two-step verification is already set up."]);
  const secret = newTotpSecret(); u.mfa = { secret: await seal(secret, key, PURPOSE), confirmed: false, lastStep: -1, recovery: [] };
  return { secret, otpauth: otpauthUri(secret, u.email) };
}
export async function confirmMfaSetup(db: MemoryDb, actor: Actor, sid: string, code: string, key: string, now = Date.now()) {
  const u = db.users.get(actor.id); if (!u?.mfa || u.mfa.confirmed) throw new ValidationError(["Start setup first."]);
  const seed = await open(u.mfa.secret, key, PURPOSE);
  const step = seed === null ? null : await verifyTotp(seed, code, now);
  if (step === null) throw new ValidationError(["That code isn't right. Check your authenticator app and try again."]);
  const codes = Array.from({ length: RECOVERY_COUNT }, recoveryCode);
  u.mfa = { ...u.mfa, confirmed: true, lastStep: step, recovery: await Promise.all(codes.map((c) => sha256Hex(c))) };
  const s = db.sessions.get(sid); if (s) s.mfaOk = true;
  db.log("mfa.enabled", { userId: u.id }); return { recoveryCodes: codes };
}
export async function verifyMfa(db: MemoryDb, actor: Actor, sid: string, code: string, key: string, now = Date.now()): Promise<boolean> {
  if (STAFF_OPEN_ACCESS) {
    const s = db.sessions.get(sid);
    if (s) s.mfaOk = true;
    return true;
  }
  const u = db.users.get(actor.id); const s = db.sessions.get(sid);
  if (!u?.mfa?.confirmed || !s) return false;
  const seed = await open(u.mfa.secret, key, PURPOSE);
  const step = seed === null ? null : await verifyTotp(seed, code, now, u.mfa.lastStep);
  if (step !== null) { if (seed !== null && !u.mfa.secret.startsWith("v1.")) u.mfa.secret = await seal(seed, key, PURPOSE); u.mfa.lastStep = step; u.mfa.failures = 0; s.mfaOk = true; db.log("mfa.verified", { userId: u.id }); return true; }
  const h = await sha256Hex(code.trim().toLowerCase()), i = u.mfa.recovery.indexOf(h);
  if (i >= 0) { u.mfa.recovery.splice(i, 1); u.mfa.failures = 0; s.mfaOk = true; db.log("mfa.recovery_used", { userId: u.id, remaining: u.mfa.recovery.length }); return true; }
  u.mfa.failures = (u.mfa.failures ?? 0) + 1;
  if (u.mfa.failures >= 5) { s.revoked = true; u.mfa.failures = 0; db.log("mfa.lockout", { userId: u.id }); } else db.log("mfa.failed", { userId: u.id });
  return false;
}
export function resetStaffMfa(db: MemoryDb, actor: Actor | null, userId: string) {
  requirePermission(actor, "staff.manage");
  const u = db.users.get(userId);
  if (!u || u.kind !== "staff" || u.roles.includes("owner") || u.id === actor.id) throw new ValidationError(["Unknown staff member."]);
  delete u.mfa; for (const s of db.sessions.values()) if (s.userId === u.id) s.revoked = true;
  db.log("mfa.reset_by_owner", { userId }, actor.id);
}
