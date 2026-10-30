import { describe, expect, test } from "vitest";
import { base32Decode, base32Encode, hotp, otpauthUri, verifyTotp } from "../lib/security/totp";

const RFC = base32Encode(new TextEncoder().encode("12345678901234567890"));
describe("totp", () => {
  test("RFC 4226/6238 vectors", async () => {
    expect(await hotp(RFC, 0)).toBe("755224"); expect(await hotp(RFC, 1)).toBe("287082"); expect(await hotp(RFC, 9)).toBe("520489");
    expect(await hotp(RFC, Math.floor(59 / 30), 8)).toBe("94287082"); // RFC 6238 appendix B, T=59
    expect(await hotp(RFC, Math.floor(1111111109 / 30), 8)).toBe("07081804");
  });
  test("base32 round trips and rejects junk", () => { const b = crypto.getRandomValues(new Uint8Array(20)); expect([...base32Decode(base32Encode(b))]).toEqual([...b]); expect(() => base32Decode("!!")).toThrow(); });
  test("window ±1, no replay, rejects malformed", async () => {
    const t = 1_700_000_000_000, step = Math.floor(t / 30000);
    const code = await hotp(RFC, step);
    expect(await verifyTotp(RFC, code, t)).toBe(step);
    expect(await verifyTotp(RFC, code, t + 30_000)).toBe(step); // one step later still accepted
    expect(await verifyTotp(RFC, code, t + 90_000)).toBeNull(); // too old
    expect(await verifyTotp(RFC, code, t, step)).toBeNull(); // replay
    for (const bad of ["", "12345", "abcdef", "1234567"]) expect(await verifyTotp(RFC, bad, t)).toBeNull();
  });
  test("provisioning URI", () => { expect(otpauthUri("ABC", "a@b.co")).toBe("otpauth://totp/Dera%20Darko%20Trade:a%40b.co?secret=ABC&issuer=Dera%20Darko%20Trade&algorithm=SHA1&digits=6&period=30"); });
});
