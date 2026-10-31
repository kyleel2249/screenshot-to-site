/**
 * Product photo storage on Cloudflare R2 (binding `MEDIA`). Staff upload; everyone can view. Only raster images are accepted — and verified by
 * their actual bytes, not the file name or declared type — so nothing active (SVG, HTML, scripts) can ever be hosted on the shop's own domain.
 */
export interface R2Like {
  put(key: string, value: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string; cacheControl?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream | ArrayBuffer | null; httpMetadata?: { contentType?: string } } | null>;
}
export const MEDIA_MAX_BYTES = 3_000_000;
const KEY_RE = /^[a-f0-9]{32}\.(jpg|png|webp|gif)$/;
export type ImageKind = { ext: "jpg" | "png" | "webp" | "gif"; type: string };

/** Identifies JPEG / PNG / WebP / GIF from the file's leading bytes; anything else is rejected. */
export function sniffImage(b: Uint8Array): ImageKind | null {
  const at = (i: number, ...v: number[]) => v.every((x, j) => b[i + j] === x);
  if (b.length > 3 && at(0, 0xff, 0xd8, 0xff)) return { ext: "jpg", type: "image/jpeg" };
  if (b.length > 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { ext: "png", type: "image/png" };
  if (b.length > 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return { ext: "webp", type: "image/webp" };
  if (b.length > 6 && at(0, 0x47, 0x49, 0x46, 0x38) && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return { ext: "gif", type: "image/gif" };
  return null;
}
const hex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => x.toString(16).padStart(2, "0")).join("");

export async function storeImage(bucket: R2Like, data: ArrayBuffer): Promise<{ url: string } | { error: string }> {
  if (data.byteLength === 0) return { error: "Choose an image file." };
  if (data.byteLength > MEDIA_MAX_BYTES) return { error: `The image is too large (${MEDIA_MAX_BYTES / 1_000_000} MB maximum). Resize it and try again.` };
  const kind = sniffImage(new Uint8Array(data, 0, Math.min(16, data.byteLength)));
  if (!kind) return { error: "Only JPEG, PNG, WebP or GIF images can be uploaded." };
  const key = `${hex(16)}.${kind.ext}`;
  await bucket.put(key, data, { httpMetadata: { contentType: kind.type, cacheControl: "public, max-age=31536000, immutable" } });
  return { url: `/media/${key}` };
}

export async function serveImage(bucket: R2Like | undefined, key: string): Promise<Response> {
  const gone = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  if (!bucket || !KEY_RE.test(key)) return gone();
  const obj = await bucket.get(key); if (!obj || !obj.body) return gone();
  const type = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" }[key.split(".")[1] as "jpg"];
  // Content type comes from the validated extension we generated, never from stored metadata a caller could influence.
  return new Response(obj.body as BodyInit, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cross-Origin-Resource-Policy": "same-origin" } });
}
