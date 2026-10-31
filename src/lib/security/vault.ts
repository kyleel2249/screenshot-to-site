/**
 * Encrypts small secrets stored in the database (e.g. staff authenticator seeds) with AES-256-GCM, so a copy of the
 * database alone can't be used to generate second-factor codes. The key is derived (HKDF-SHA256) from a server-side secret
 * that never lives in the database. Format: `v1.<iv>.<ciphertext>` (base64url). Anything else is treated as legacy plaintext.
 */
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function keyFor(secret: string, purpose: string): Promise<CryptoKey> {
  if (secret.length < 16) throw new Error("Encryption secret is too short.");
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: enc.encode("ddt-vault-v1"), info: enc.encode(purpose) }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export const isSealed = (v: string) => v.startsWith("v1.");
export async function seal(plain: string, secret: string, purpose: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(purpose) }, await keyFor(secret, purpose), enc.encode(plain)));
  return `v1.${b64(iv)}.${b64(ct)}`;
}
/** Returns null when the value is sealed but can't be opened (wrong key or tampering); legacy plaintext is returned as is. */
export async function open(value: string, secret: string, purpose: string): Promise<string | null> {
  if (!isSealed(value)) return value;
  const [, iv, ct] = value.split(".");
  if (!iv || !ct) return null;
  try { return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv), additionalData: enc.encode(purpose) }, await keyFor(secret, purpose), unb64(ct))); } catch { return null; }
}
