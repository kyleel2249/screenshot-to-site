import { checkPasswordPolicy, hashPassword, randomToken, sha256Hex, signSession, verifyPassword, verifySession } from "../../lib/security/crypto";
import { enrolOwner, type AdminStore } from "../../lib/security/enrolment";
import type { MemoryDb, UserRow } from "../db";
import type { Actor } from "../rbac";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FAILS = 5, LOCK_MS = 15 * 60_000, SESSION_MS = 12 * 3600_000;
const norm = (e: string) => e.trim().toLowerCase();
const byEmail = (db: MemoryDb, email: string) => [...db.users.values()].find((u) => u.email === norm(email));
export const GENERIC_LOGIN_ERROR = "Incorrect email or password.";

export async function registerCustomer(db: MemoryDb, i: { email: string; password: string; firstName: string; lastName: string; acceptTerms: boolean; marketingConsent?: boolean }, iterations?: number) {
  const errors: string[] = [];
  if (!EMAIL.test(i.email)) errors.push("Enter a valid email address.");
  if (!i.firstName.trim() || !i.lastName.trim()) errors.push("Name is required.");
  if (!i.acceptTerms) errors.push("You must accept the terms and privacy policy.");
  errors.push(...checkPasswordPolicy(i.password));
  if (errors.length) return { ok: false as const, errors };
  // Same response whether or not the email exists, so registration cannot be used to enumerate accounts.
  if (!byEmail(db, i.email)) {
    const id = db.nextId("usr");
    db.users.set(id, { id, email: norm(i.email), passwordHash: await hashPassword(i.password, iterations), kind: "customer", roles: [], status: "active", emailVerified: false, failedLogins: 0, lockedUntil: 0, mfaRequired: false, createdAt: Date.now() });
    db.profiles.set(id, { userId: id, firstName: i.firstName.trim(), lastName: i.lastName.trim(), marketingConsent: i.marketingConsent === true }); // never pre-ticked
    const token = randomToken();
    db.tokens.set(await sha256Hex(token), { userId: id, kind: "verify", expiresAt: Date.now() + 24 * 3600_000 });
    db.log("customer.registered", { userId: id });
    return { ok: true as const, verifyToken: token }; // delivered by email only
  }
  return { ok: true as const };
}

export async function verifyEmail(db: MemoryDb, token: string, now = Date.now()) {
  const h = await sha256Hex(token), t = db.tokens.get(h);
  db.tokens.delete(h);
  if (!t || t.kind !== "verify" || t.expiresAt < now) return false;
  const u = db.users.get(t.userId); if (!u) return false;
  u.emailVerified = true; db.log("email.verified", { userId: u.id }); return true;
}

export async function login(db: MemoryDb, i: { email: string; password: string; secret: string; now?: number }) {
  const now = i.now ?? Date.now();
  const u = byEmail(db, i.email);
  if (!u || u.status !== "active") { await verifyPassword(i.password, "pbkdf2-sha256$1000$AAAA$AAAA"); return { ok: false as const, error: GENERIC_LOGIN_ERROR }; }
  if (u.lockedUntil > now) return { ok: false as const, error: "Too many attempts. Try again later." };
  if (!(await verifyPassword(i.password, u.passwordHash))) {
    u.failedLogins++;
    if (u.failedLogins >= MAX_FAILS) { u.lockedUntil = now + LOCK_MS; u.failedLogins = 0; db.log("login.locked", { userId: u.id }); }
    db.log("login.failed", { userId: u.id });
    return { ok: false as const, error: GENERIC_LOGIN_ERROR };
  }
  if (u.kind === "staff" && !u.emailVerified) return { ok: false as const, error: GENERIC_LOGIN_ERROR };
  u.failedLogins = 0;
  const sid = db.nextId("ses");
  db.sessions.set(sid, { id: sid, userId: u.id, expiresAt: now + SESSION_MS, revoked: false, authAt: now, mfaOk: u.kind !== "staff" }); // staff sessions are unusable until the second factor is proven
  db.log("login.success", { userId: u.id });
  return { ok: true as const, token: await signSession({ sid, sub: u.id, exp: now + SESSION_MS }, i.secret), authAt: now };
}

export async function authenticate(db: MemoryDb, token: string | undefined, secret: string, _unused?: number, now = Date.now()): Promise<Actor | null> {
  void _unused;
  if (!token) return null;
  const p = await verifySession(token, secret, now); if (!p) return null;
  const s = db.sessions.get(p.sid); const u = db.users.get(p.sub);
  if (!s || s.revoked || s.expiresAt < now || !u || u.status !== "active" || s.userId !== u.id) return null;
  return { id: u.id, kind: u.kind, roles: u.roles, recentAuthAt: s.authAt, mfaOk: u.kind !== "staff" || s.mfaOk === true }; // derived from the server-side session, never from the client
}
/** Step-up: re-verify the password to refresh the session's recent-authentication time (needed for refunds/exports). */
export async function reauthenticate(db: MemoryDb, sid: string, password: string, now = Date.now()) {
  const s = db.sessions.get(sid); const u = s && db.users.get(s.userId);
  if (!s || !u || !(await verifyPassword(password, u.passwordHash))) return false;
  s.authAt = now; db.log("reauth.success", { userId: u.id }); return true;
}
export const logout = (db: MemoryDb, sid: string) => { const s = db.sessions.get(sid); if (s) s.revoked = true; };
export const revokeAllSessions = (db: MemoryDb, userId: string) => { for (const s of db.sessions.values()) if (s.userId === userId) s.revoked = true; };

export async function requestPasswordReset(db: MemoryDb, email: string, now = Date.now()) {
  const u = byEmail(db, email);
  if (!u || u.status !== "active") return { ok: true as const }; // generic
  const t = randomToken();
  db.tokens.set(await sha256Hex(t), { userId: u.id, kind: "reset", expiresAt: now + 30 * 60_000 });
  db.log("password.reset_requested", { userId: u.id });
  return { ok: true as const, token: t };
}
export async function resetPassword(db: MemoryDb, token: string, newPassword: string, now = Date.now(), iterations?: number) {
  const errors = checkPasswordPolicy(newPassword); if (errors.length) return { ok: false as const, errors };
  const h = await sha256Hex(token), t = db.tokens.get(h);
  db.tokens.delete(h); // single use even on failure paths below
  if (!t || t.kind !== "reset" || t.expiresAt < now) return { ok: false as const, errors: ["This reset link is invalid or has expired."] };
  const u = db.users.get(t.userId)!; u.passwordHash = await hashPassword(newPassword, iterations); u.failedLogins = 0; u.lockedUntil = 0;
  revokeAllSessions(db, u.id);
  db.log("password.reset_completed", { userId: u.id });
  return { ok: true as const };
}

/** Admin-initiated reset: sends the same secure link flow; the admin never sees a password or token. */
export async function staffInitiateReset(db: MemoryDb, actor: Actor, userId: string) {
  const u = db.users.get(userId); if (!u) return;
  db.log("password.reset_initiated_by_staff", { userId }, actor.id);
  return requestPasswordReset(db, u.email);
}

export function adminStoreFor(db: MemoryDb, iterations?: number): AdminStore & { iterations?: number | undefined } {
  return {
    iterations,
    adminCount: async () => [...db.users.values()].filter((u) => u.kind === "staff").length,
    isSetupClosed: async () => db.adminSetupClosed,
    createOwner: async (i) => {
      if ([...db.users.values()].some((u) => u.kind === "staff") || db.adminSetupClosed) throw new Error("Setup closed");
      const id = db.nextId("usr");
      const row: UserRow = { id, email: i.email, passwordHash: i.passwordHash, kind: "staff", roles: ["owner"], status: "active", emailVerified: false, failedLogins: 0, lockedUntil: 0, mfaRequired: true, createdAt: Date.now() };
      db.users.set(id, row); db.tokens.set(i.verifyToken, { userId: id, kind: "verify", expiresAt: Date.now() + 24 * 3600_000 });
      db.adminSetupClosed = true;
    },
    audit: async (event, detail) => { db.log(event, detail); },
  };
}
export { enrolOwner };
