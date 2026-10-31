/**
 * Product image management with provenance. Every image is either a verified photo (supplier/manufacturer/own) or an illustrative concept
 * (for example AI-generated). Nothing becomes public until staff approve it, replacing the main image never deletes the old one, and an
 * illustrative image is always flagged so the shop never presents it as a verified photograph.
 */
import type { MediaItem, MemoryDb, ProductRow } from "../db";
import { requirePermission, type Actor } from "../rbac";
import { ValidationError } from "./catalog-admin";

const URL_OK = /^(\/media\/[a-f0-9]{32}\.(?:jpg|png|webp|gif)|https:\/\/[^\s"'<>]{4,500})$/;
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
const product = (db: MemoryDb, id: string): ProductRow => { const p = db.products.get(id); if (!p) throw new ValidationError(["Unknown product."]); return p; };

export function listMedia(db: MemoryDb, actor: Actor | null, productId: string) {
  requirePermission(actor, "product.read");
  const p = product(db, productId);
  return { primary: { url: p.image, alt: p.imageAlt }, items: p.media ?? [] };
}

export function addMedia(db: MemoryDb, actor: Actor | null, productId: string, input: Record<string, unknown>): MediaItem {
  requirePermission(actor, "product.write");
  const p = product(db, productId); const errors: string[] = [];
  const url = clip(input["url"], 520), alt = clip(input["alt"], 200), kind = input["kind"], caption = clip(input["caption"], 200), canva = clip(input["canvaDesignId"], 40);
  if (!URL_OK.test(url)) errors.push("The image must be an uploaded photo or an https link.");
  if (!alt) errors.push("Describe the image for screen readers (alt text).");
  if (kind !== "verified" && kind !== "illustrative") errors.push("Say whether this is a verified photo or an illustrative image.");
  if (canva && !/^D[a-zA-Z0-9_-]{10}$/.test(canva)) errors.push("That doesn't look like a Canva design ID.");
  if ((p.media ?? []).length >= 20) errors.push("A product can have up to 20 images.");
  if (errors.length) throw new ValidationError(errors);
  const item: MediaItem = { id: db.nextId("img"), url, alt, kind: kind as MediaItem["kind"], status: "pending", createdAt: Date.now(), by: actor!.id, ...(caption ? { caption } : {}), ...(canva ? { canvaDesignId: canva } : {}) };
  (p.media ??= []).push(item);
  db.log("product.image_added", { productId, imageId: item.id, kind: item.kind }, actor!.id);
  return item;
}

export function reviewMedia(db: MemoryDb, actor: Actor | null, productId: string, imageId: string, action: unknown): MediaItem {
  requirePermission(actor, "product.write");
  const p = product(db, productId); const media = (p.media ??= []);
  const it = media.find((m) => m.id === imageId); if (!it) throw new ValidationError(["Unknown image."]);
  if (action === "approve") { it.status = "approved"; }
  else if (action === "reject") { if (p.image === it.url) throw new ValidationError(["This is the main image. Make another image the main one first."]); it.status = "rejected"; }
  else if (action === "make_primary") {
    if (it.status !== "approved") throw new ValidationError(["Approve the image before making it the main image."]);
    if (p.image && p.image !== it.url && !media.some((m) => m.url === p.image)) media.push({ id: db.nextId("img"), url: p.image, alt: p.imageAlt, kind: "previous", status: "approved", createdAt: Date.now(), by: actor!.id }); // keep the old one, never delete
    p.image = it.url; p.imageAlt = it.alt; p.updatedAt = new Date().toISOString();
  } else throw new ValidationError(["Unknown action."]);
  db.log(`product.image_${action}`, { productId, imageId }, actor!.id);
  return it;
}

/** What shoppers see: approved images only, and whether the main image is an illustration. Provenance details stay internal. */
export function publicMedia(p: ProductRow) {
  const m = p.media ?? [];
  return { gallery: m.filter((x) => x.status === "approved" && x.kind !== "previous" && x.url !== p.image).map((x) => ({ url: x.url, alt: x.alt, ...(x.caption ? { caption: x.caption } : {}), illustrative: x.kind === "illustrative" })),
    illustrative: m.some((x) => x.url === p.image && x.kind === "illustrative") };
}
