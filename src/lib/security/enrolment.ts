/**
 * One-time administrator enrolment.
 *
 * The owner-supplied enrolment reference is a BOOTSTRAP value, not a password. Only its SHA-256 hash is
 * configured on the server (secret `ADMIN_BOOTSTRAP_REF_HASH`); the raw value is never committed, bundled,
 * logged or returned. Enrolment succeeds only while no administrator exists and setup is open, and the
 * reference is invalidated afterwards.
 *
 * This module is storage-agnostic: callers supply an AdminStore (D1/Postgres/etc.) that must perform
 * `createOwner` + `closeSetup` in ONE transaction.
 */
import { checkPasswordPolicy, hashPassword, randomToken, sha256Hex, timingSafeEqual, RateLimiter } from "./crypto";

export interface AdminStore {
  adminCount(): Promise<number>;
  isSetupClosed(): Promise<boolean>;
  /** Atomically: insert owner (emailVerified=false), close setup, write audit record. Must fail if an admin exists. */
  createOwner(input: { email: string; passwordHash: string; verifyToken: string }): Promise<void>;
  audit(event: string, detail: Record<string, string | number | boolean>): Promise<void>;
}

export type EnrolmentResult =
  | { ok: true; verifyToken: string }
  | { ok: false; code: "setup_closed" | "rate_limited" | "invalid" | "weak_password" | "bad_email"; errors?: string[] };

const limiter = new RateLimiter(5, 15 * 60_000);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function enrolOwner(
  store: AdminStore,
  env: { ADMIN_BOOTSTRAP_REF_HASH?: string },
  input: { reference: string; email: string; password: string; clientKey: string },
): Promise<EnrolmentResult> {
  if (!limiter.check(input.clientKey).allowed) { await store.audit("enrol.rate_limited", { key: input.clientKey }); return { ok: false, code: "rate_limited" }; }
  // Generic failure for every precondition so the endpoint reveals nothing about setup state.
  if (!env.ADMIN_BOOTSTRAP_REF_HASH || (await store.isSetupClosed()) || (await store.adminCount()) > 0) {
    await store.audit("enrol.rejected", { reason: "closed" });
    return { ok: false, code: "setup_closed" };
  }
  const given = await sha256Hex(input.reference.trim());
  if (!timingSafeEqual(given, env.ADMIN_BOOTSTRAP_REF_HASH.toLowerCase())) {
    await store.audit("enrol.rejected", { reason: "bad_reference" });
    return { ok: false, code: "invalid" };
  }
  if (!EMAIL.test(input.email)) return { ok: false, code: "bad_email" };
  const errors = checkPasswordPolicy(input.password);
  if (errors.length) return { ok: false, code: "weak_password", errors };
  const verifyToken = randomToken();
  await store.createOwner({ email: input.email.toLowerCase(), passwordHash: await hashPassword(input.password), verifyToken: await sha256Hex(verifyToken) });
  await store.audit("enrol.completed", { email: input.email.toLowerCase() }); // never the reference or password
  return { ok: true, verifyToken }; // emailed to the owner; only its hash is stored
}

/** Non-obvious dashboard mount path, configured via secret ADMIN_PORTAL_PATH (never the literal word "admin"). */
export function resolvePortalPath(env: { ADMIN_PORTAL_PATH?: string }): string | null {
  const p = env.ADMIN_PORTAL_PATH?.replace(/^\/+|\/+$/g, "");
  if (!p || p.length < 12 || /admin/i.test(p) || !/^[a-z0-9-]+$/i.test(p)) return null;
  return `/${p}`;
}

export interface ResetStore {
  saveReset(userId: string, tokenHash: string, expiresAt: number): Promise<void>;
  consumeReset(tokenHash: string, now: number): Promise<{ userId: string } | null>; // atomic single-use
  setPassword(userId: string, passwordHash: string): Promise<void>;
  revokeSessions(userId: string): Promise<void>;
  audit(event: string, detail: Record<string, string | number | boolean>): Promise<void>;
}
export async function requestReset(store: ResetStore, userId: string | null, now = Date.now()): Promise<{ token?: string }> {
  if (!userId) return {}; // caller returns the same generic response either way (no account enumeration)
  const token = randomToken();
  await store.saveReset(userId, await sha256Hex(token), now + 30 * 60_000);
  await store.audit("password.reset_requested", { userId });
  return { token };
}
export async function completeReset(store: ResetStore, token: string, newPassword: string, now = Date.now()): Promise<{ ok: boolean; errors?: string[] }> {
  const errors = checkPasswordPolicy(newPassword);
  if (errors.length) return { ok: false, errors };
  const hit = await store.consumeReset(await sha256Hex(token), now);
  if (!hit) return { ok: false, errors: ["This reset link is invalid or has expired."] };
  await store.setPassword(hit.userId, await hashPassword(newPassword));
  await store.revokeSessions(hit.userId);
  await store.audit("password.reset_completed", { userId: hit.userId });
  return { ok: true };
}
