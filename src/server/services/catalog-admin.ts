import { addCategory, renameCategory, reorder, setPublished, slugify, type FilterProfile } from "../../lib/domain/categories";
import type { VariantRecord } from "../../lib/domain/commerce";
import { sellableQty, type Availability, type PromoWindow } from "../../lib/domain/status";
import type { MemoryDb, ProductRow } from "../db";
import { requirePermission, type Actor } from "../rbac";

export class ValidationError extends Error { constructor(public errors: string[]) { super(errors.join(" ")); this.name = "ValidationError"; } }

export interface NewProduct {
  name: string; categoryId: string; shortDescription: string; description?: string; image: string; imageAlt: string;
  sku: string; priceGhs?: number; priceUsd?: number; onHand?: number; weightGrams?: number; trackInventory?: boolean;
  availability?: Availability; promo?: PromoWindow[]; expectedWindow?: string; preOrderEnabled?: boolean; allowBackorder?: boolean; published?: boolean;
}
const isMinor = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;

export function createProduct(db: MemoryDb, actor: Actor | null, input: NewProduct): ProductRow {
  requirePermission(actor, "product.write");
  const errors: string[] = [];
  if (!input.name.trim()) errors.push("Name is required.");
  if (!db.categories.some((c) => c.id === input.categoryId)) errors.push("Unknown category.");
  if (input.priceGhs === undefined && input.priceUsd === undefined) errors.push("Set a price in at least one currency.");
  for (const [k, v] of [["GHS price", input.priceGhs], ["USD price", input.priceUsd], ["stock", input.onHand]] as const) if (v !== undefined && !isMinor(v)) errors.push(`${k} must be a non-negative whole number of minor units.`);
  if ([...db.variants.values()].some((v) => v.id.split("::")[1] === input.sku)) errors.push("SKU already exists.");
  if (input.availability === "pre_order" && !input.preOrderEnabled) errors.push("Enable pre-orders explicitly to use the Pre-order status.");
  if (errors.length) throw new ValidationError(errors);

  let slug = slugify(input.name), n = 2;
  while ([...db.products.values()].some((p) => p.slug === slug)) slug = `${slugify(input.name)}-${n++}`;
  const id = db.nextId("prod"), now = new Date().toISOString();
  const row: ProductRow = { id, slug, name: input.name.trim(), categoryId: input.categoryId, shortDescription: input.shortDescription, description: input.description ?? input.shortDescription, image: input.image, imageAlt: input.imageAlt, promo: input.promo ?? [], ...(input.expectedWindow ? { expectedWindow: input.expectedWindow } : {}), attributes: {}, createdAt: now, updatedAt: now, archived: false };
  const v: VariantRecord = {
    id: `${id}::${input.sku}`, productId: id, name: input.name.trim(),
    price: { ...(input.priceGhs !== undefined ? { GHS: input.priceGhs } : {}), ...(input.priceUsd !== undefined ? { USD: input.priceUsd } : {}) },
    weightGrams: input.weightGrams ?? 0, categoryIds: [input.categoryId],
    availability: input.availability ?? "available", trackInventory: input.trackInventory ?? true, onHand: input.onHand ?? 0, reserved: 0,
    allowBackorder: input.allowBackorder ?? false, published: input.published ?? false,
    ...(input.preOrderEnabled ? { preOrder: { enabled: true, sold: 0, ...(input.expectedWindow ? { expectedWindow: input.expectedWindow } : {}) } } : {}),
  };
  db.products.set(id, row); db.variants.set(v.id, v);
  db.log("product.created", { productId: id, sku: input.sku }, actor.id);
  return row;
}

const variantsOf = (db: MemoryDb, productId: string) => [...db.variants.values()].filter((v) => v.productId === productId);

/** Single or bulk status change. All-or-nothing: if any product is invalid, nothing changes. */
export function setAvailability(db: MemoryDb, actor: Actor | null, productIds: string[], availability: Availability) {
  requirePermission(actor, "product.write");
  const errors: string[] = [];
  for (const id of productIds) {
    const vs = variantsOf(db, id);
    if (!db.products.has(id)) errors.push(`Unknown product ${id}.`);
    if (availability === "pre_order" && vs.some((v) => !v.preOrder?.enabled)) errors.push(`${db.products.get(id)?.name ?? id}: enable pre-orders before using Pre-order status.`);
  }
  if (errors.length) throw new ValidationError(errors);
  for (const id of productIds) for (const v of variantsOf(db, id)) {
    const before = v.availability; v.availability = availability;
    db.log("product.availability_changed", { productId: id, from: before, to: availability }, actor.id);
  }
}

export function setPublishedState(db: MemoryDb, actor: Actor | null, productId: string, published: boolean) {
  requirePermission(actor, "product.write");
  if (!db.products.has(productId)) throw new ValidationError(["Unknown product."]);
  for (const v of variantsOf(db, productId)) v.published = published;
  db.log(published ? "product.published" : "product.unpublished", { productId }, actor.id);
}

export function setPrices(db: MemoryDb, actor: Actor | null, variantId: string, p: { ghs?: number; usd?: number; saleGhs?: number; saleUsd?: number; saleStartsAt?: string; saleEndsAt?: string }) {
  requirePermission(actor, "product.write");
  const v = db.variants.get(variantId);
  if (!v) throw new ValidationError(["Unknown variant."]);
  for (const [k, n] of Object.entries({ ghs: p.ghs, usd: p.usd, saleGhs: p.saleGhs, saleUsd: p.saleUsd })) if (n !== undefined && !isMinor(n)) throw new ValidationError([`${k} must be a non-negative integer in minor units.`]);
  const next = { ...v.price, ...(p.ghs !== undefined ? { GHS: p.ghs } : {}), ...(p.usd !== undefined ? { USD: p.usd } : {}) };
  const sale = { ...(v.salePrice ?? {}), ...(p.saleGhs !== undefined ? { GHS: p.saleGhs } : {}), ...(p.saleUsd !== undefined ? { USD: p.saleUsd } : {}) };
  for (const c of ["GHS", "USD"] as const) if (sale[c] !== undefined && next[c] !== undefined && sale[c]! >= next[c]!) throw new ValidationError([`Sale price (${c}) must be lower than the regular price.`]);
  if (p.saleStartsAt && p.saleEndsAt && new Date(p.saleStartsAt) > new Date(p.saleEndsAt)) throw new ValidationError(["Sale start must be before sale end."]);
  db.log("price.changed", { variantId, oldGhs: v.price.GHS ?? -1, newGhs: next.GHS ?? -1, oldUsd: v.price.USD ?? -1, newUsd: next.USD ?? -1 }, actor.id);
  v.price = next;
  if (Object.keys(sale).length) v.salePrice = sale;
  if (p.saleStartsAt) v.saleStartsAt = p.saleStartsAt;
  if (p.saleEndsAt) v.saleEndsAt = p.saleEndsAt;
}

/** Stock can never go negative or below what is already reserved. Every change records who made it. */
export function adjustStock(db: MemoryDb, actor: Actor | null, variantId: string, delta: number, reason: string) {
  requirePermission(actor, "inventory.adjust");
  const v = db.variants.get(variantId);
  if (!v) throw new ValidationError(["Unknown variant."]);
  if (!Number.isInteger(delta) || delta === 0) throw new ValidationError(["Adjustment must be a non-zero whole number."]);
  if (!reason.trim()) throw new ValidationError(["A reason is required."]);
  if (v.onHand + delta < v.reserved) throw new ValidationError([`Cannot reduce below reserved stock (${v.reserved}).`]);
  v.onHand += delta;
  db.log("inventory.adjusted", { variantId, delta, reason: reason.trim(), onHandAfter: v.onHand, sellable: sellableQty(v) }, actor.id);
}

export function archiveProduct(db: MemoryDb, actor: Actor | null, productId: string) {
  requirePermission(actor, "product.write");
  const p = db.products.get(productId);
  if (!p) throw new ValidationError(["Unknown product."]);
  p.archived = true;
  for (const v of variantsOf(db, productId)) { v.published = false; v.availability = "discontinued"; }
  db.log("product.archived", { productId }, actor.id);
}

/** Domain errors from category operations become 422 validation errors, never 500s; permission errors pass through. */
function guarded<T>(fn: () => T): T {
  try { return fn(); } catch (e) {
    if (e instanceof Error && e.name !== "Forbidden" && !(e instanceof ValidationError)) throw new ValidationError([e.message]);
    throw e;
  }
}
export function categoryAdmin(db: MemoryDb, actor: Actor | null) {
  requirePermission(actor, "category.write");
  const exists = (id: string) => { if (!db.categories.some((c) => c.id === id)) throw new Error("Unknown category."); };
  return {
    list: () => db.categories,
    add: (name: string, parentId: string | null, filterProfile?: FilterProfile) => guarded(() => {
      if (parentId !== null) { exists(parentId); if (db.categories.find((c) => c.id === parentId)?.parentId) throw new Error("Categories can be at most two levels deep."); }
      db.categories = addCategory(db.categories, { name, parentId, ...(filterProfile ? { filterProfile } : {}) }); db.log("category.added", { name }, actor.id);
    }),
    rename: (id: string, name: string) => guarded(() => { exists(id); db.categories = renameCategory(db.categories, id, name); db.log("category.renamed", { id }, actor.id); }),
    hide: (id: string, hidden: boolean) => guarded(() => { exists(id); db.categories = setPublished(db.categories, id, !hidden); db.log("category.visibility", { id, hidden }, actor.id); }),
    move: (id: string, position: number) => guarded(() => { exists(id); db.categories = reorder(db.categories, id, position); db.log("category.reordered", { id, position }, actor.id); }),
  };
}
