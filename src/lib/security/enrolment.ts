/**
 * One-time administrator enrolment.
 *
 * TEMP: while STAFF_OPEN_ACCESS is true, ADMIN_BOOTSTRAP_REF_HASH is not required and a default portal path is used.
 */
import { checkPasswordPolicy, hashPassword, randomToken, sha256Hex, timingSafeEqual, RateLimiter } from "./crypto";
import { OPEN_ACCESS_PORTAL_PATH, STAFF_OPEN_ACCESS } from "./open-access";

export interface AdminStore {
  adminCount(): Promise<number>;
  isSetupClosed(): Promise<boolean>;
  createOwner(input: { email: string; passwordHash: string; verifyToken: string; temporaryPassword?: boolean }): Promise<void>;
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
  input: { reference: string; email: string; password: string; clientKey: string; temporaryPassword?: boolean },
): Promise<EnrolmentResult> {
  if (!limiter.check(input.clientKey).allowed) { await store.audit("enrol.rate_limited", { key: input.clientKey }); return { ok: false, code: "rate_limited" }; }
  if ((await store.isSetupClosed()) || (await store.adminCount()) > 0) {
    await store.audit("enrol.rejected", { reason: "closed" });
    return { ok: false, code: "setup_closed" };
  }
  if (!STAFF_OPEN_ACCESS) {
    if (!env.ADMIN_BOOTSTRAP_REF_HASH) {
      await store.audit("enrol.rejected", { reason: "closed" });
      return { ok: false, code: "setup_closed" };
    }
    const given = await sha256Hex(input.reference.trim());
    if (!timingSafeEqual(given, env.ADMIN_BOOTSTRAP_REF_HASH.toLowerCase())) {
      await store.audit("enrol.rejected", { reason: "bad_reference" });
      return { ok: false, code: "invalid" };
    }
  }
  if (!EMAIL.test(input.email)) return { ok: false, code: "bad_email" };
  const password = (input.password || "").trim() || (STAFF_OPEN_ACCESS ? "OpenAccess-Temp-Change-Me-1!" : "");
  const errors = STAFF_OPEN_ACCESS ? [] : checkPasswordPolicy(password);
  if (errors.length) return { ok: false, code: "weak_password", errors };
  const verifyToken = randomToken();
  await store.createOwner({ email: input.email.toLowerCase(), passwordHash: await hashPassword(password), verifyToken: await sha256Hex(verifyToken), ...(input.temporaryPassword && !STAFF_OPEN_ACCESS ? { temporaryPassword: true } : {}) });
  await store.audit("enrol.completed", { email: input.email.toLowerCase(), temporaryPassword: !!input.temporaryPassword });
  return { ok: true, verifyToken };
}

/** Non-obvious dashboard mount path. TEMP open access falls back to OPEN_ACCESS_PORTAL_PATH. */
export function resolvePortalPath(env: { ADMIN_PORTAL_PATH?: string }): string | null {
  let p = env.ADMIN_PORTAL_PATH?.replace(/^\/+|\/+$/g, "");
  if ((!p || p.length < 12) && STAFF_OPEN_ACCESS) p = OPEN_ACCESS_PORTAL_PATH;
  if (!p || p.length < 12 || /admin/i.test(p) || !/^[a-z0-9-]+$/i.test(p)) return null;
  return `/${p}`;
}

export interface ResetStore {
  saveReset(userId: string, tokenHash: string, expiresAt: number): Promise<void>;
  consumeReset(tokenHash: string, now: number): Promise<{ userId: string } | null>;
  setPassword(userId: string, passwordHash: string): Promise<void>;
  revokeSessions(userId: string): Promise<void>;
  audit(event: string, detail: Record<string, string | number | boolean>): Promise<void>;
}
export async function requestReset(store: ResetStore, userId: string | null, now = Date.now()): Promise<{ token?: string }> {
  if (!userId) return {};
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
