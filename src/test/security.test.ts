import { describe, expect, test } from "vitest";
import { hashPassword, verifyPassword, checkPasswordPolicy, signSession, verifySession, RateLimiter, csvCell, sha256Hex } from "../lib/security/crypto";
import { enrolOwner, resolvePortalPath, requestReset, completeReset, type AdminStore, type ResetStore } from "../lib/security/enrolment";

// Test-only reference; the real owner reference is NEVER stored in the repository.
const REF = "test-reference-not-real";
const GOOD_PW = "Str0ng!Passw0rd#";

function memStore() {
  const s = { admins: [] as { email: string; passwordHash: string }[], closed: false, audit: [] as string[], tokens: [] as string[] };
  const store: AdminStore = {
    adminCount: async () => s.admins.length,
    isSetupClosed: async () => s.closed,
    createOwner: async (i) => { if (s.admins.length) throw new Error("exists"); s.admins.push({ email: i.email, passwordHash: i.passwordHash }); s.closed = true; s.tokens.push(i.verifyToken); },
    audit: async (e, d) => { s.audit.push(e + JSON.stringify(d)); },
  };
  return { s, store };
}

describe("passwords & sessions", () => {
  test("hash/verify, no plaintext, unique salts", async () => {
    const a = await hashPassword(GOOD_PW, 1000), b = await hashPassword(GOOD_PW, 1000);
    expect(a).not.toContain(GOOD_PW); expect(a).not.toBe(b);
    expect(await verifyPassword(GOOD_PW, a)).toBe(true);
    expect(await verifyPassword("wrong", a)).toBe(false);
    expect(await verifyPassword(GOOD_PW, "garbage")).toBe(false);
  });
  test("policy", () => { expect(checkPasswordPolicy("short").length).toBeGreaterThan(0); expect(checkPasswordPolicy(GOOD_PW)).toEqual([]); });
  test("session tokens: valid, tampered, expired", async () => {
    const t = await signSession({ sid: "s1", sub: "u1", exp: Date.now() + 60_000 }, "secret");
    expect((await verifySession(t, "secret"))?.sub).toBe("u1");
    expect(await verifySession(t, "other")).toBeNull();
    expect(await verifySession(t.replace(/.$/, "x"), "secret")).toBeNull();
    expect(await verifySession(await signSession({ sid: "s", sub: "u", exp: 1 }, "secret"), "secret")).toBeNull();
  });
  test("rate limiter", () => {
    const r = new RateLimiter(2, 1000);
    expect(r.check("k", 0).allowed).toBe(true); expect(r.check("k", 1).allowed).toBe(true); expect(r.check("k", 2).allowed).toBe(false); expect(r.check("k", 2000).allowed).toBe(true);
  });
  test("csv formula injection neutralised", () => { expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)"); expect(csvCell('a,"b"')).toBe('"a,""b"""'); });
});

describe("one-time admin enrolment", () => {
  test("works once with the right reference, then is permanently closed", async () => {
    const { s, store } = memStore();
    const env = { ADMIN_BOOTSTRAP_REF_HASH: await sha256Hex(REF) };
    const r = await enrolOwner(store, env, { reference: REF, email: "Owner@Example.com", password: GOOD_PW, clientKey: "ip1" });
    expect(r.ok).toBe(true);
    expect(s.admins[0].email).toBe("owner@example.com");
    expect(s.admins[0].passwordHash).not.toContain(GOOD_PW);
    const again = await enrolOwner(store, env, { reference: REF, email: "x@y.com", password: GOOD_PW, clientKey: "ip2" });
    expect(again).toEqual({ ok: false, code: "setup_closed" });
    expect(s.admins.length).toBe(1);
  });
  test("wrong reference, missing config, weak password, bad email are rejected", async () => {
    const { s, store } = memStore();
    const env = { ADMIN_BOOTSTRAP_REF_HASH: await sha256Hex(REF) };
    expect((await enrolOwner(store, env, { reference: "nope", email: "a@b.co", password: GOOD_PW, clientKey: "a" })).ok).toBe(false);
    expect(await enrolOwner(store, {}, { reference: REF, email: "a@b.co", password: GOOD_PW, clientKey: "b" })).toEqual({ ok: false, code: "setup_closed" });
    expect(await enrolOwner(store, env, { reference: REF, email: "a@b.co", password: "weak", clientKey: "c" })).toMatchObject({ ok: false, code: "weak_password" });
    expect(await enrolOwner(store, env, { reference: REF, email: "bad", password: GOOD_PW, clientKey: "d" })).toEqual({ ok: false, code: "bad_email" });
    expect(s.admins.length).toBe(0);
  });
  test("brute force is rate limited and audit log never contains the reference or password", async () => {
    const { s, store } = memStore();
    const env = { ADMIN_BOOTSTRAP_REF_HASH: await sha256Hex(REF) };
    let limited = false;
    for (let i = 0; i < 8; i++) { const r = await enrolOwner(store, env, { reference: "guess" + i, email: "a@b.co", password: GOOD_PW, clientKey: "attacker" }); if (!r.ok && r.code === "rate_limited") limited = true; }
    expect(limited).toBe(true);
    expect(s.audit.join("\n")).not.toContain(REF);
    expect(s.audit.join("\n")).not.toContain(GOOD_PW);
  });
  test("portal path must be non-obvious and never contain 'admin'", () => {
    expect(resolvePortalPath({})).toBeNull();
    expect(resolvePortalPath({ ADMIN_PORTAL_PATH: "admin-console-xyz" })).toBeNull();
    expect(resolvePortalPath({ ADMIN_PORTAL_PATH: "short" })).toBeNull();
    expect(resolvePortalPath({ ADMIN_PORTAL_PATH: "/ops-k7q2m9x4p1z8/" })).toBe("/ops-k7q2m9x4p1z8");
  });
});

describe("password reset", () => {
  function rs() {
    const st = { resets: new Map<string, { userId: string; exp: number }>(), pw: "", revoked: 0, audit: [] as string[] };
    const store: ResetStore = {
      saveReset: async (u, h, e) => { st.resets.set(h, { userId: u, exp: e }); },
      consumeReset: async (h, now) => { const r = st.resets.get(h); st.resets.delete(h); return r && r.exp > now ? { userId: r.userId } : null; },
      setPassword: async (_u, h) => { st.pw = h; },
      revokeSessions: async () => { st.revoked++; },
      audit: async (e) => { st.audit.push(e); },
    };
    return { st, store };
  }
  test("single-use, expiring, revokes sessions, generic for unknown accounts", async () => {
    const { st, store } = rs();
    expect(await requestReset(store, null)).toEqual({});
    const { token } = await requestReset(store, "u1", 0);
    expect(token).toBeTruthy();
    expect((await completeReset(store, token!, "weak", 1)).ok).toBe(false);
    expect((await completeReset(store, token!, GOOD_PW, 1)).ok).toBe(true);
    expect(st.revoked).toBe(1); expect(st.pw).not.toContain(GOOD_PW);
    expect((await completeReset(store, token!, GOOD_PW, 2)).ok).toBe(false); // reuse blocked
    const { token: t2 } = await requestReset(store, "u1", 0);
    expect((await completeReset(store, t2!, GOOD_PW, 31 * 60_000)).ok).toBe(false); // expired
  });
});

import { open as vaultOpen, seal as vaultSeal, isSealed } from "../lib/security/vault";
describe("vault (encryption at rest)", () => {
  test("round-trips, uses a fresh IV, binds to purpose, rejects wrong key and tampering, passes legacy plaintext through", async () => {
    const key = "k".repeat(32);
    const a = await vaultSeal("JBSWY3DPEHPK3PXP", key, "staff-totp"), b = await vaultSeal("JBSWY3DPEHPK3PXP", key, "staff-totp");
    expect(isSealed(a)).toBe(true); expect(a).not.toContain("JBSWY3DP"); expect(a).not.toBe(b);
    expect(await vaultOpen(a, key, "staff-totp")).toBe("JBSWY3DPEHPK3PXP");
    expect(await vaultOpen(a, "z".repeat(32), "staff-totp")).toBeNull();
    expect(await vaultOpen(a, key, "other-purpose")).toBeNull();
    const [v, iv, ct] = a.split("."); expect(await vaultOpen(`${v}.${iv}.${ct!.slice(0, -2)}AA`, key, "staff-totp")).toBeNull();
    expect(await vaultOpen("v1.broken", key, "staff-totp")).toBeNull();
    expect(await vaultOpen("LEGACYPLAINSEED", key, "staff-totp")).toBe("LEGACYPLAINSEED");
    await expect(vaultSeal("x", "short", "p")).rejects.toThrow();
  });
});
