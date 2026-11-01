import { describe, expect, test } from "vitest";
import { hashPassword, verifyPassword, checkPasswordPolicy, signSession, verifySession, RateLimiter, csvCell, sha256Hex } from "../lib/security/crypto";

// Test-only reference; the real owner reference is NEVER stored in the repository.
const REF = "test-reference-not-real";
const GOOD_PW = "Str0ng!Passw0rd#";

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
