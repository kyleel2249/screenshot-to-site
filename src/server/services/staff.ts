/**
 * Staff accounts. Only the owner holds `staff.manage` (a sensitive permission: recent re-authentication required).
 * Invited staff exist in an unusable state (empty password hash, suspended) until they accept a single-use, expiring link
 * and choose their own password — administrators never see or set anyone's password.
 */
import { checkPasswordPolicy, hashPassword, randomToken, sha256Hex } from "../../lib/security/crypto";
import type { MemoryDb, UserRow } from "../db";
import { requirePermission, ROLE_PERMISSIONS, type Actor, type Role } from "../rbac";
import { revokeAllSessions } from "./auth";
import { ValidationError } from "./catalog-admin";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const INVITE_MS = 72 * 3600_000;
export const ASSIGNABLE_ROLES = (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) => r !== "owner");

export type StaffState = "active" | "invited" | "suspended";
export interface StaffView { id: string; email: string; roles: Role[]; state: StaffState; createdAt: number }
const stateOf = (u: UserRow): StaffState => (u.passwordHash === "" ? "invited" : u.status === "active" ? "active" : "suspended");

function cleanRoles(input: unknown): Role[] {
  const roles = Array.isArray(input) ? [...new Set(input.filter((r): r is Role => typeof r === "string" && (ASSIGNABLE_ROLES as string[]).includes(r)))] : [];
  if (!roles.length) throw new ValidationError(["Choose at least one role. The owner role can't be assigned."]);
  return roles;
}
function target(db: MemoryDb, actor: Actor, userId: string): UserRow {
  const u = db.users.get(userId);
  if (!u || u.kind !== "staff") throw new ValidationError(["Unknown staff member."]);
  if (u.roles.includes("owner")) throw new ValidationError(["The owner account can't be changed here."]);
  if (u.id === actor.id) throw new ValidationError(["You can't change your own access."]);
  return u;
}

export function listStaff(db: MemoryDb, actor: Actor | null): StaffView[] {
  requirePermission(actor, "staff.manage");
  return [...db.users.values()].filter((u) => u.kind === "staff").map((u) => ({ id: u.id, email: u.email, roles: u.roles, state: stateOf(u), createdAt: u.createdAt })).sort((a, b) => a.createdAt - b.createdAt);
}

/** Creates (or re-issues) an invitation. Returns the raw token exactly once, for delivery to the invitee. */
export async function inviteStaff(db: MemoryDb, actor: Actor | null, i: { email: string; roles: unknown }, now = Date.now()): Promise<{ token: string; email: string }> {
  requirePermission(actor, "staff.manage", now);
  const email = i.email.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new ValidationError(["Enter a valid email address."]);
  const roles = cleanRoles(i.roles);
  let u = [...db.users.values()].find((x) => x.email === email);
  if (u && !(u.kind === "staff" && u.passwordHash === "")) throw new ValidationError(["That email already has an account."]);
  if (u) { for (const [h, t] of db.tokens) if (t.userId === u.id && t.kind === "invite") db.tokens.delete(h); u.roles = roles; } // re-invite: old link dies
  else {
    const id = db.nextId("usr");
    u = { id, email, passwordHash: "", kind: "staff", roles, status: "suspended", emailVerified: false, failedLogins: 0, lockedUntil: 0, mfaRequired: true, createdAt: now };
    db.users.set(id, u);
  }
  const token = randomToken();
  db.tokens.set(await sha256Hex(token), { userId: u.id, kind: "invite", expiresAt: now + INVITE_MS });
  db.log("staff.invited", { userId: u.id, roles: roles.join(",") }, actor.id);
  return { token, email };
}

export async function acceptInvite(db: MemoryDb, token: string, password: string, now = Date.now(), iterations?: number): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const errors = checkPasswordPolicy(password); if (errors.length) return { ok: false, errors };
  const h = await sha256Hex(token), t = db.tokens.get(h);
  db.tokens.delete(h); // single use, even on the failure paths below
  const u = t && t.kind === "invite" && t.expiresAt >= now ? db.users.get(t.userId) : undefined;
  if (!u || u.kind !== "staff" || u.passwordHash !== "") return { ok: false, errors: ["This invitation is invalid or has expired. Ask the owner to send a new one."] };
  u.passwordHash = await hashPassword(password, iterations); u.status = "active"; u.emailVerified = true; // the emailed link proves control of the address
  db.log("staff.invite_accepted", { userId: u.id });
  return { ok: true };
}

export function setStaffRoles(db: MemoryDb, actor: Actor | null, userId: string, roles: unknown) {
  requirePermission(actor, "staff.manage");
  const u = target(db, actor, userId); const next = cleanRoles(roles);
  u.roles = next; revokeAllSessions(db, u.id); // new permissions apply from the next sign-in
  db.log("staff.roles_changed", { userId, roles: next.join(",") }, actor.id);
}
export function setStaffActive(db: MemoryDb, actor: Actor | null, userId: string, active: boolean) {
  requirePermission(actor, "staff.manage");
  const u = target(db, actor, userId);
  if (u.passwordHash === "") throw new ValidationError(["This person hasn't accepted their invitation yet."]);
  u.status = active ? "active" : "suspended"; if (!active) revokeAllSessions(db, u.id);
  db.log(active ? "staff.reactivated" : "staff.suspended", { userId }, actor.id);
}
