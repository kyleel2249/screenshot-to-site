/**
 * Server-only security primitives built on Web Crypto (runs on Cloudflare Workers, Node 20+ and Bun).
 * Never import this module from client code.
 */
const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf instanceof Uint8Array ? buf : new Uint8Array(buf))));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const PBKDF2_ITERATIONS = 310_000; // OWASP guidance for PBKDF2-HMAC-SHA256
// Cloudflare Workers caps PBKDF2 iterations at 100,000; the iteration count is stored per-hash so it can be raised on other runtimes.

export function randomToken(bytes = 32): string {
  return b64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function timingSafeEqual(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function sha256Hex(input: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, 256);
}

/** Format: pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>. Plaintext is never stored. */
export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${iterations}$${b64(salt)}$${b64(await pbkdf2(password, salt, iterations))}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, it, salt, hash] = stored.split("$");
  if (alg !== "pbkdf2-sha256" || !it || !salt || !hash) return false;
  const derived = b64(await pbkdf2(password, unb64(salt), parseInt(it, 10)));
  return timingSafeEqual(derived, hash);
}

export interface PasswordPolicy { minLength: number }
export const DEFAULT_POLICY: PasswordPolicy = { minLength: 12 };
export function checkPasswordPolicy(pw: string, policy = DEFAULT_POLICY): string[] {
  const errs: string[] = [];
  if (pw.length < policy.minLength) errs.push(`Use at least ${policy.minLength} characters.`);
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) errs.push("Include upper- and lower-case letters.");
  if (!/\d/.test(pw)) errs.push("Include a number.");
  if (!/[^A-Za-z0-9]/.test(pw)) errs.push("Include a symbol.");
  return errs;
}

/** HMAC-signed, expiring session token: `<payload b64url>.<sig>`. Store the session id server-side so it can be revoked. */
async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function signSession(payload: { sid: string; sub: string; exp: number }, secret: string): Promise<string> {
  const body = b64(enc.encode(JSON.stringify(payload))).replace(/=+$/, "");
  const sig = b64(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body))).replace(/=+$/, "");
  return `${body}.${sig}`;
}
export async function verifySession(token: string, secret: string, now = Date.now()): Promise<{ sid: string; sub: string; exp: number } | null> {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = b64(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body))).replace(/=+$/, "");
  if (!timingSafeEqual(expected, sig)) return null;
  try {
    const p = JSON.parse(atob(body + "=".repeat((4 - (body.length % 4)) % 4)));
    return typeof p.exp === "number" && p.exp > now ? p : null;
  } catch { return null; }
}

/** Fixed-window in-memory limiter. On Workers, back this with a Durable Object / KV for cross-isolate accuracy. */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private max: number, private windowMs: number) {}
  check(key: string, now = Date.now()): { allowed: boolean; retryAfterMs: number } {
    const e = this.hits.get(key);
    if (!e || e.resetAt <= now) { this.hits.set(key, { count: 1, resetAt: now + this.windowMs }); return { allowed: true, retryAfterMs: 0 }; }
    e.count++;
    return e.count > this.max ? { allowed: false, retryAfterMs: e.resetAt - now } : { allowed: true, retryAfterMs: 0 };
  }
}

/** Neutralise spreadsheet formula injection in CSV exports. */
export function csvCell(v: unknown): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
