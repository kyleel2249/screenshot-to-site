import { checkPasswordPolicy, hashPassword, randomToken, sha256Hex, signSession, verifyPassword, verifySession } from "../../lib/security/crypto";
import { enrolOwner, type AdminStore } from "../../lib/security/enrolment";
import type { MemoryDb, UserRow } from "../db";
import type { Actor } from "../rbac";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FAILS = 5, LOCK_MS = 15 * 60_000, SESSION_MS = 12 * 3600_000;
const norm = (e: string) => e.trim().toLowerCase();
const byEmail = (db: MemoryDb, email: string) => [...db.users.values()].find((u) => u.email === norm(email));
export const GENERIC_LOGIN_ERROR = "Incorrect email or password.";

/** TEMPORARY: staff access is open (no password / email-verify / MFA gate). Set to false and redeploy when locking down for production. */
export const STAFF_OPEN_ACCESS = true;

export async function registerCustomer(db: MemoryDb, i: { email: string; password: string; firstName: string; lastName: string; acceptTerms: boolean; marketingConsent?: boolean }, iterations?: number) {
  const errors: string[] = [];
  if (!EMAIL.test(i.email)) errors.push("Enter a valid email address.");
  if (!i.firstName.trim() || !i.lastName.trim()) errors.push("Name is required.");
  if (!i.acceptTerms) errors.push("You must accept the terms and privacy policy.");
  errors.push(...checkPasswordPolicy(i.password));
  if (errors.length) return { ok: false as const, errors };
  if (!byEmail(db, i.email)) {
    const id = db.nextId("usr");
    db.users.set(id, { id, email: norm(i.email), passwordHash: await hashPassword(i.password, iterations), kind: "customer", roles: [], status: "active", emailVerified: false, failedLogins: 0, lockedUntil: 0, mfaRequired: false, createdAt: Date.now() });
    db.profiles.set(id, { userId: id, firstName: i.firstName.trim(), lastName: i.lastName.trim(), marketingConsent: i.marketingConsent === true });
    const token = randomToken();
    db.tokens.set(await sha256Hex(token), { userId: id, kind: "verify", expiresAt: Date.now() + 24 * 3600_000 });
    db.log("customer.registered", { userId: id });
    return { ok: true as const, verifyToken: token };
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

export async function login(db: MemoryDb, i: { email: string; password: string; secret: string; now?: number; openAdmin?: boolean }) {
  const now = i.now ?? Date.now();
  const openAdmin = i.openAdmin === true || (i.openAdmin !== false && STAFF_OPEN_ACCESS);
  const u = byEmail(db, i.email);
  if (!u || u.status !== "active") { await verifyPassword(i.password || "x", "pbkdf2-sha256$1000$AAAA$AAAA"); return { ok: false as const, error: GENERIC_LOGIN_ERROR }; }
  if (u.lockedUntil > now && !(openAdmin && u.kind === "staff")) return { ok: false as const, error: "Too many attempts. Try again later." };
  if (openAdmin && u.kind === "staff") {
    u.emailVerified = true;
    u.failedLogins = 0;
    u.lockedUntil = 0;
    delete u.mustChangePassword;
    const sid = db.nextId("ses");
    db.sessions.set(sid, { id: sid, userId: u.id, expiresAt: now + SESSION_MS, revoked: false, authAt: now, mfaOk: true });
    db.log("login.success_open_admin", { userId: u.id });
    return { ok: true as const, token: await signSession({ sid, sub: u.id, exp: now + SESSION_MS }, i.secret), authAt: now };
  }
  if (!(await verifyPassword(i.password, u.passwordHash))) {
    u.failedLogins++;
    if (u.failedLogins >= MAX_FAILS) { u.lockedUntil = now + LOCK_MS; u.failedLogins = 0; db.log("login.locked", { userId: u.id }); }
    db.log("login.failed", { userId: u.id });
    return { ok: false as const, error: GENERIC_LOGIN_ERROR };
  }
  if (u.kind === "staff" && !u.emailVerified) return { ok: false as const, error: GENERIC_LOGIN_ERROR };
  u.failedLogins = 0;
  const sid = db.nextId("ses");
  db.sessions.set(sid, { id: sid, userId: u.id, expiresAt: now + SESSION_MS, revoked: false, authAt: now, mfaOk: u.kind !== "staff" });
  db.log("login.success", { userId: u.id });
  return { ok: true as const, token: await signSession({ sid, sub: u.id, exp: now + SESSION_MS }, i.secret), authAt: now };
}

export async function authenticate(db: MemoryDb, token: string | undefined, secret: string, _unused?: number, now = Date.now(), openAdmin = STAFF_OPEN_ACCESS): Promise<Actor | null> {
  void _unused;
  if (!token) return null;
  const p = await verifySession(token, secret, now); if (!p) return null;
  const s = db.sessions.get(p.sid); const u = db.users.get(p.sub);
  if (!s || s.revoked || s.expiresAt < now || !u || u.status !== "active" || s.userId !== u.id) return null;
  if (openAdmin && u.kind === "staff") s.mfaOk = true;
  return { id: u.id, kind: u.kind, roles: u.roles, recentAuthAt: s.authAt, mfaOk: u.kind !== "staff" || s.mfaOk === true || (openAdmin && u.kind === "staff") };
}

export async function reauthenticate(db: MemoryDb, sid: string, password: string, now = Date.now(), openAdmin = STAFF_OPEN_ACCESS) {
  const s = db.sessions.get(sid); const u = s && db.users.get(s.userId);
  if (!s || !u) return false;
  if (openAdmin && u.kind === "staff") { s.authAt = now; db.log("reauth.success_open_admin", { userId: u.id }); return true; }
  if (!(await verifyPassword(password, u.passwordHash))) return false;
  s.authAt = now; db.log("reauth.success", { userId: u.id }); return true;
}
export const logout = (db: MemoryDb, sid: string) => { const s = db.sessions.get(sid); if (s) s.revoked = true; };
export const revokeAllSessions = (db: MemoryDb, userId: string) => { for (const s of db.sessions.values()) if (s.userId === userId) s.revoked = true; };

export async function requestPasswordReset(db: MemoryDb, email: string, now = Date.now()) {
  const u = byEmail(db, email);
  if (!u || u.status !== "active") return { ok: true as const };
  const t = randomToken();
  db.tokens.set(await sha256Hex(t), { userId: u.id, kind: "reset", expiresAt: now + 30 * 60_000 });
  db.log("password.reset_requested", { userId: u.id });
  return { ok: true as const, token: t };
}
export async function resetPassword(db: MemoryDb, token: string, newPassword: string, now = Date.now(), iterations?: number) {
  const errors = checkPasswordPolicy(newPassword); if (errors.length) return { ok: false as const, errors };
  const h = await sha256Hex(token), t = db.tokens.get(h);
  db.tokens.delete(h);
  if (!t || t.kind !== "reset" || t.expiresAt < now) return { ok: false as const, errors: ["This reset link is invalid or has expired."] };
  const u = db.users.get(t.userId)!; u.passwordHash = await hashPassword(newPassword, iterations); u.failedLogins = 0; u.lockedUntil = 0;
  revokeAllSessions(db, u.id);
  db.log("password.reset_completed", { userId: u.id });
  return { ok: true as const };
}

export async function changePassword(db: MemoryDb, actor: Actor, sid: string, current: string, next: string, now = Date.now(), iterations?: number) {
  const u = db.users.get(actor.id), s = db.sessions.get(sid);
  if (!u || !s || s.userId !== u.id) return { ok: false as const, errors: ["Sign in again."] };
  if (STAFF_OPEN_ACCESS && u.kind === "staff") {
    const errors = checkPasswordPolicy(next);
    if (errors.length) return { ok: false as const, errors };
    u.passwordHash = await hashPassword(next, iterations); delete u.mustChangePassword; u.failedLogins = 0; u.lockedUntil = 0;
    s.authAt = now;
    db.log("password.changed_open_admin", { userId: u.id });
    return { ok: true as const };
  }
  if (!(await verifyPassword(current, u.passwordHash))) { db.log("password.change_failed", { userId: u.id }); return { ok: false as const, errors: ["Your current password isn't right."] }; }
  const errors = checkPasswordPolicy(next);
  if (next === current) errors.push("Choose a password different from your current one.");
  if (errors.length) return { ok: false as const, errors };
  u.passwordHash = await hashPassword(next, iterations); delete u.mustChangePassword; u.failedLogins = 0; u.lockedUntil = 0;
  for (const x of db.sessions.values()) if (x.userId === u.id && x.id !== sid) x.revoked = true;
  s.authAt = now;
  db.log("password.changed", { userId: u.id });
  return { ok: true as const };
}

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
      // TEMP: open access marks owner email verified immediately.
      const row: UserRow = { id, email: i.email, passwordHash: i.passwordHash, kind: "staff", roles: ["owner"], status: "active", emailVerified: STAFF_OPEN_ACCESS, failedLogins: 0, lockedUntil: 0, mfaRequired: !STAFF_OPEN_ACCESS, createdAt: Date.now(), ...(i.temporaryPassword && !STAFF_OPEN_ACCESS ? { mustChangePassword: true } : {}) };
      db.users.set(id, row); db.tokens.set(i.verifyToken, { userId: id, kind: "verify", expiresAt: Date.now() + 24 * 3600_000 });
      db.adminSetupClosed = true;
    },
    audit: async (event, detail) => { db.log(event, detail); },
  };
}
export { enrolOwner };
