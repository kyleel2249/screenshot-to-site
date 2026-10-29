/**
 * Pure storefront helpers over the PUBLIC product view served by GET /api/products.
 * The server already resolves effective availability, honest promo labels and sale validity, so nothing here
 * re-derives stock rules. Cart totals shown here are ESTIMATES: checkout re-prices on the server with live data.
 */
import type { ApiProduct } from "./api-client";
import { descendantIds, type CategoryNode } from "./domain/categories";
import { add, priceLabels, type Currency, type DisplayMode, type ExchangeRate, type Money } from "./domain/money";
import type { Availability, PromoLabel } from "./domain/status";
import type { CartLine } from "./cart-core";

export type StoreProduct = ApiProduct;

export const isPurchasable = (p: Pick<StoreProduct, "availability">) => p.availability === "available" || p.availability === "pre_order";
export const hasLabel = (p: StoreProduct, l: PromoLabel) => p.labels.includes(l);
export const withAvailability = (list: StoreProduct[], a: Availability) => list.filter((p) => p.availability === a);
export const findProduct = (list: StoreProduct[], slug: string) => list.find((p) => p.slug === slug);
export const findByVariant = (list: StoreProduct[], variantId: string) => list.find((p) => p.variantId === variantId);

export function productsIn(list: StoreProduct[], categories: CategoryNode[], categoryId?: string): StoreProduct[] {
  if (!categoryId) return list;
  const ids = new Set(descendantIds(categories, categoryId));
  return list.filter((p) => ids.has(p.categoryId));
}

/** Lowest current GHS price in minor units (sale price when present); products without a GHS price sort last. */
export const cheapestGhs = (p: StoreProduct) => (p.salePrice ?? p.price).GHS ?? Number.MAX_SAFE_INTEGER;

export function search(list: StoreProduct[], q: string): StoreProduct[] {
  const n = q.trim().toLowerCase();
  if (!n) return list;
  return list.filter((p) => p.name.toLowerCase().includes(n) || (p.variantId.split("::")[1] ?? "").toLowerCase().includes(n));
}
export function sortProducts(list: StoreProduct[], sort: "newest" | "price-asc" | "price-desc" | undefined): StoreProduct[] {
  return [...list].sort((a, b) => sort === "price-asc" ? cheapestGhs(a) - cheapestGhs(b) : sort === "price-desc" ? cheapestGhs(b) - cheapestGhs(a) : b.createdAt.localeCompare(a.createdAt));
}

/** Prices for a display mode. An exchange rate is only used when the owner configured one; none is ever assumed. */
export function displayPrice(p: StoreProduct, mode: DisplayMode, rate?: ExchangeRate) {
  return { current: priceLabels(p.salePrice ?? p.price, mode, rate), original: p.salePrice ? priceLabels(p.price, mode, rate) : [] };
}

/** Client-side guard for add-to-cart. The server remains the authority on stock. */
export function canAdd(p: StoreProduct | undefined, nextQty: number): { ok: true } | { ok: false; reason: string } {
  if (!p) return { ok: false, reason: "This product is no longer available." };
  if (!isPurchasable(p)) return { ok: false, reason: p.availability === "out_of_stock" ? "Out of stock." : p.availability === "coming_soon" ? "Coming soon — not yet purchasable." : "This product can't be purchased right now." };
  if (p.remaining !== undefined && nextQty > p.remaining) return { ok: false, reason: `Only ${p.remaining} left.` };
  return { ok: true };
}

export interface EstimatedLine { variantId: string; product: StoreProduct; qty: number; unit: Money; line: Money; mode: "stock" | "preorder" }
export type Estimate = { ok: true; lines: EstimatedLine[]; subtotal: Money; hasPreorder: boolean } | { ok: false; errors: string[]; lines: EstimatedLine[] };

export function estimate(lines: CartLine[], list: StoreProduct[], currency: Currency): Estimate {
  const out: EstimatedLine[] = []; const errors: string[] = [];
  for (const l of lines) {
    const p = findByVariant(list, l.variantId);
    if (!p) { errors.push("An item in your cart is no longer available. Remove it to continue."); continue; }
    const g = canAdd(p, l.qty);
    if (!g.ok) { errors.push(`${p.name}: ${g.reason}`); continue; }
    const unit = (p.salePrice ?? p.price)[currency];
    if (unit === undefined) { errors.push(`${p.name} is not sold in ${currency}.`); continue; }
    out.push({ variantId: l.variantId, product: p, qty: l.qty, unit: { amount: unit, currency }, line: { amount: unit * l.qty, currency }, mode: p.availability === "pre_order" ? "preorder" : "stock" });
  }
  if (errors.length || out.length === 0) return { ok: false, errors: [...new Set(errors)], lines: out };
  return { ok: true, lines: out, subtotal: out.map((l) => l.line).reduce((a, b) => add(a, b)), hasPreorder: out.some((l) => l.mode === "preorder") };
}
