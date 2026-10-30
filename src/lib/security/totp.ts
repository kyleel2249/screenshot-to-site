/** RFC 6238 time-based one-time passwords (HMAC-SHA1, 30 s step, 6 digits) — what authenticator apps implement. */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const STEP_SECONDS = 30;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Uint8Array {
  const clean = s.replace(/[\s=-]/g, "").toUpperCase(); let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) { const i = B32.indexOf(ch); if (i < 0) throw new Error("Invalid base32"); value = (value << 5) | i; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Uint8Array.from(out);
}
export const newTotpSecret = () => base32Encode(crypto.getRandomValues(new Uint8Array(20)));

export async function hotp(secretB32: string, counter: number, digits = 6): Promise<string> {
  const key = await crypto.subtle.importKey("raw", base32Decode(secretB32) as BufferSource, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const msg = new ArrayBuffer(8); const dv = new DataView(msg); dv.setUint32(0, Math.floor(counter / 2 ** 32)); dv.setUint32(4, counter >>> 0);
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg)); const o = h[19]! & 15;
  const bin = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return (bin % 10 ** digits).toString().padStart(digits, "0");
}
export const totp = (secretB32: string, nowMs = Date.now()) => hotp(secretB32, Math.floor(nowMs / 1000 / STEP_SECONDS));

/** Accepts the current step ±1 (clock drift). Returns the matched step so callers can refuse replays, or null. */
export async function verifyTotp(secretB32: string, code: string, nowMs = Date.now(), afterStep = -1): Promise<number | null> {
  if (!/^\d{6}$/.test(code.trim())) return null;
  const now = Math.floor(nowMs / 1000 / STEP_SECONDS);
  for (const step of [now - 1, now, now + 1]) {
    if (step <= afterStep) continue; // already used (or older than a used code): replay
    if ((await hotp(secretB32, step)) === code.trim()) return step;
  }
  return null;
}
export const otpauthUri = (secret: string, account: string, issuer = "Dera Darko Trade") =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
