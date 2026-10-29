/**
 * Provider-agnostic webhook authenticity check (HMAC over the RAW request body).
 * Provider adapters supply the header name/algorithm; this never trusts a parsed body or a browser redirect.
 */
import { timingSafeEqual } from "../security/crypto";

export type HmacAlg = "SHA-256" | "SHA-512";
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function hmacHex(secret: string, rawBody: string, alg: HmacAlg = "SHA-512"): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: alg }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(rawBody)));
}

export async function verifyWebhook(opts: { secret: string | undefined; rawBody: string; signature: string | null | undefined; alg?: HmacAlg; timestamp?: number; toleranceMs?: number; now?: number }): Promise<boolean> {
  if (!opts.secret || !opts.signature) return false; // missing config or header: fail closed
  if (opts.timestamp !== undefined) { // optional replay window
    const now = opts.now ?? Date.now();
    if (Math.abs(now - opts.timestamp) > (opts.toleranceMs ?? 5 * 60_000)) return false;
  }
  return timingSafeEqual(await hmacHex(opts.secret, opts.rawBody, opts.alg), opts.signature.trim().toLowerCase());
}
