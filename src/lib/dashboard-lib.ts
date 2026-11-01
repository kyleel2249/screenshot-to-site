/**
 * Pure helpers for the customer dashboard (no React, no I/O) so they are unit-tested.
 * Everything here works on the REAL public catalogue; nothing is invented (no fake ratings, popularity or stock claims).
 */
import { descendantIds, type CategoryNode } from "./domain/categories";
import type { Currency } from "./domain/money";
import type { Availability } from "./domain/status";
import type { SaleInfo } from "./guest-types";
import type { StoreProduct } from "./storefront";

/* ---------------- navigation (22 modules, each one is a working screen) ---------------- */
export const MODULES = [
  { id: "home", label: "Dashboard Home", group: "Shop" },
  { id: "shop", label: "Shop All Products", group: "Shop" },
  { id: "categories", label: "Categories", group: "Shop" },
  { id: "new", label: "New Arrivals", group: "Shop" },
  { id: "best", label: "Best Sellers", group: "Shop" },
  { id: "featured", label: "Featured Products", group: "Shop" },
  { id: "offers", label: "Special Offers", group: "Shop" },
  { id: "wishlist", label: "My Wishlist", group: "My shopping" },
  { id: "cart", label: "My Shopping Cart", group: "My shopping" },
  { id: "compare", label: "Product Comparison", group: "My shopping" },
  { id: "viewed", label: "Recently Viewed", group: "My shopping" },
  { id: "orders", label: "My Orders", group: "Orders & returns" },
  { id: "track", label: "Track My Order", group: "Orders & returns" },
  { id: "returns", label: "My Returns & Refunds", group: "Orders & returns" },
  { id: "addresses", label: "Saved Addresses", group: "Orders & returns" },
  { id: "notifications", label: "Notifications", group: "Help & settings" },
  { id: "support", label: "Customer Support", group: "Help & settings" },
  { id: "faq", label: "Frequently Asked Questions", group: "Help & settings" },
  { id: "delivery", label: "Delivery Information", group: "Help & settings" },
  { id: "about", label: "About Dera Darko Trade", group: "Help & settings" },
  { id: "contact", label: "Contact Us", group: "Help & settings" },
  { id: "preferences", label: "Shopping Preferences", group: "Help & settings" },
] as const;
export type ModuleId = (typeof MODULES)[number]["id"];
export const MODULE_IDS = MODULES.map((m) => m.id) as ModuleId[];
export const isModule = (v: unknown): v is ModuleId => typeof v === "string" && (MODULE_IDS as string[]).includes(v);
/** Mobile bottom bar: the five things people reach for most. */
export const BOTTOM_NAV: ModuleId[] = ["home", "shop", "cart", "orders"];

/* ---------------- catalogue filtering / sorting ---------------- */
export const SORTS = [
  { id: "newest", label: "Newest first" },
  { id: "popular", label: "Most popular" },
  { id: "best", label: "Best selling" },
  { id: "featured", label: "Featured products" },
  { id: "rated", label: "Highest rated" },
  { id: "price-asc", label: "Price: low to high" },
  { id: "price-desc", label: "Price: high to low" },
] as const;
export type SortId = (typeof SORTS)[number]["id"];

export interface Filters {
  q: string; categoryId: string; min: string; max: string; currency: Currency; brand: string; model: string;
  availability: "" | Availability | "buyable"; onlyPromo: boolean; onlyNew: boolean; minRating: number; sort: SortId;
}
export const DEFAULT_FILTERS: Filters = { q: "", categoryId: "", min: "", max: "", currency: "GHS", brand: "", model: "", availability: "", onlyPromo: false, onlyNew: false, minRating: 0, sort: "newest" };

export const unitPrice = (p: StoreProduct, c: Currency): number | undefined => p.salePrice?.[c] ?? p.price[c];
export const isOnSale = (p: StoreProduct) => !!p.salePrice && Object.entries(p.salePrice).some(([c, v]) => v !== undefined && p.price[c as Currency] !== undefined && v < (p.price[c as Currency] as number));
export const sku = (p: StoreProduct) => p.variantId.split("::")[1] ?? "";
export const isNew = (p: StoreProduct) => p.labels.includes("new_arrival") || p.labels.includes("just_landed");

const brandOf = (p: StoreProduct) => p.attributes["brand"] ?? p.attributes["make"] ?? "";
const modelOf = (p: StoreProduct) => p.attributes["model"] ?? "";
/** Distinct brand / model values that actually exist in these products. */
export function facetValues(list: StoreProduct[]) {
  const brands = new Set<string>(), models = new Set<string>();
  for (const p of list) { const b = brandOf(p), m = modelOf(p); if (b) brands.add(b); if (m) models.add(m); }
  const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
  return { brands: sorted(brands), models: sorted(models) };
}

/** Whole-word-prefix match across name, SKU, description, category (and its parent), brand, model and every attribute value. */
export function searchText(p: StoreProduct, categories: CategoryNode[]): string {
  const own = categories.find((c) => c.id === p.categoryId), parent = own?.parentId ? categories.find((c) => c.id === own.parentId) : undefined;
  return [p.name, sku(p), p.shortDescription, own?.name ?? "", parent?.name ?? "", ...Object.values(p.attributes)].join(" ").toLowerCase();
}
export function matchesQuery(p: StoreProduct, q: string, categories: CategoryNode[]): boolean {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = searchText(p, categories);
  return words.every((w) => hay.includes(w));
}

/** Parses a decimal major-unit string ("12.5") into minor units without float maths; empty / invalid → undefined. */
export function toMinor(input: string): number | undefined {
  const m = /^\s*(\d+)(?:\.(\d{1,2}))?\s*$/.exec(input);
  return m ? parseInt(m[1]!, 10) * 100 + parseInt((m[2] ?? "").padEnd(2, "0") || "0", 10) : undefined;
}

export interface Rank { popular: string[]; }
export function filterProducts(list: StoreProduct[], f: Filters, categories: CategoryNode[]): StoreProduct[] {
  const ids = f.categoryId ? new Set(descendantIds(categories, f.categoryId)) : null;
  const min = toMinor(f.min), max = toMinor(f.max);
  return list.filter((p) => {
    if (ids && !ids.has(p.categoryId)) return false;
    if (!matchesQuery(p, f.q, categories)) return false;
    if (f.brand && brandOf(p) !== f.brand) return false;
    if (f.model && modelOf(p) !== f.model) return false;
    if (f.availability === "buyable" ? !(p.availability === "available" || p.availability === "pre_order") : f.availability && p.availability !== f.availability) return false;
    if (f.onlyPromo && !isOnSale(p)) return false;
    if (f.onlyNew && !isNew(p)) return false;
    if (f.minRating > 0 && !(p.rating && p.rating.count > 0 && p.rating.average >= f.minRating)) return false;
    if (min !== undefined || max !== undefined) {
      const u = unitPrice(p, f.currency);
      if (u === undefined) return false; // no approved price in this currency → can't satisfy a price bound
      if (min !== undefined && u < min) return false;
      if (max !== undefined && u > max) return false;
    }
    return true;
  });
}
export function sortProducts(list: StoreProduct[], sort: SortId, currency: Currency, rank: Rank): StoreProduct[] {
  const pop = new Map(rank.popular.map((s, i) => [s, i]));
  const popIdx = (p: StoreProduct) => pop.get(p.slug) ?? Number.MAX_SAFE_INTEGER;
  const newest = (a: StoreProduct, b: StoreProduct) => b.createdAt.localeCompare(a.createdAt);
  const price = (p: StoreProduct) => unitPrice(p, currency) ?? Number.MAX_SAFE_INTEGER; // unpriced always last
  const cmp: Record<SortId, (a: StoreProduct, b: StoreProduct) => number> = {
    newest,
    popular: (a, b) => popIdx(a) - popIdx(b) || newest(a, b),
    best: (a, b) => Number(b.labels.includes("best_seller")) - Number(a.labels.includes("best_seller")) || popIdx(a) - popIdx(b) || newest(a, b),
    featured: (a, b) => Number(b.labels.includes("featured")) - Number(a.labels.includes("featured")) || newest(a, b),
    rated: (a, b) => (b.rating?.count ? b.rating.average : -1) - (a.rating?.count ? a.rating.average : -1) || (b.rating?.count ?? 0) - (a.rating?.count ?? 0) || newest(a, b),
    "price-asc": (a, b) => price(a) - price(b) || newest(a, b),
    "price-desc": (a, b) => (price(b) === Number.MAX_SAFE_INTEGER ? -1 : 0) - (price(a) === Number.MAX_SAFE_INTEGER ? -1 : 0) || price(b) - price(a) || newest(a, b),
  };
  return [...list].sort(cmp[sort]);
}

/** Paged slice for "Load more" so the full catalogue stays reachable without rendering thousands of cards. */
export const PAGE_SIZE = 24;
export const page = <T,>(list: T[], pages: number) => list.slice(0, PAGE_SIZE * pages);

/* ---------------- honest section builders ---------------- */
export function topCategories(products: StoreProduct[], categories: CategoryNode[]) {
  const roots = categories.filter((c) => !c.parentId && c.published).sort((a, b) => a.position - b.position);
  return roots.map((c) => { const ids = new Set(descendantIds(categories, c.id)); return { node: c, count: products.filter((p) => ids.has(p.categoryId)).length }; });
}
/** "New arrivals": products the owner labelled new; otherwise honestly the most recently added (labelled as such by the caller). */
export function newArrivals(products: StoreProduct[], limit = 12): { items: StoreProduct[]; labelled: boolean } {
  const labelled = products.filter(isNew);
  if (labelled.length) return { items: sortProducts(labelled, "newest", "GHS", { popular: [] }).slice(0, limit), labelled: true };
  return { items: sortProducts(products, "newest", "GHS", { popular: [] }).slice(0, limit), labelled: false };
}
export const withLabel = (products: StoreProduct[], l: StoreProduct["labels"][number]) => products.filter((p) => p.labels.includes(l));

/* ---------------- comparison: category-aware rows, only verified values ---------------- */
const FIXED_ROWS = ["brand", "make", "model", "material", "size", "colour", "color", "variant", "storage", "display", "battery", "camera", "year", "engine", "transmission", "fuel", "condition", "fit", "for"] as const;
export function comparisonRows(items: StoreProduct[]): { key: string; label: string; values: (string | null)[] }[] {
  const keys = new Set<string>();
  for (const p of items) for (const [k, v] of Object.entries(p.attributes)) if (v) keys.add(k);
  const order = [...FIXED_ROWS.filter((k) => keys.has(k)), ...[...keys].filter((k) => !(FIXED_ROWS as readonly string[]).includes(k)).sort()];
  const title = (k: string) => k.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());
  return order.map((key) => ({ key, label: title(key), values: items.map((p) => p.attributes[key] ?? null) })); // null = not provided: shown as "Not provided", never guessed
}

/* ---------------- orders ---------------- */
/** Customer-facing progress steps and which one a status sits on. Unusual states (cancelled, returned, refunds) are shown as their own banner. */
export const PROGRESS_STEPS = [
  { id: "placed", label: "Order placed", statuses: ["pending_payment", "payment_under_review"] },
  { id: "paid", label: "Payment confirmed", statuses: ["payment_confirmed"] },
  { id: "prep", label: "Processing", statuses: ["processing", "preparing_dispatch", "ready_for_pickup"] },
  { id: "ship", label: "On its way", statuses: ["dispatched", "in_transit", "out_for_delivery", "delivery_attempted"] },
  { id: "done", label: "Delivered", statuses: ["delivered"] },
] as const;
export function progressIndex(status: string): number {
  const i = PROGRESS_STEPS.findIndex((s) => (s.statuses as readonly string[]).includes(status));
  return i; // -1 for cancelled / returned / refund states
}
export const orderBucket = (status: string): "pending" | "active" | "completed" | "closed" =>
  status === "pending_payment" || status === "payment_under_review" ? "pending" : status === "delivered" ? "completed" : ["cancelled", "refunded", "returned"].includes(status) ? "closed" : "active";

/* ---------------- offers ---------------- */
export function offerView(sale: SaleInfo, products: StoreProduct[]) { const p = products.find((x) => x.slug === sale.slug); return p ? { sale, product: p } : null; }
export const saleWindowLabel = (s: SaleInfo) => (s.startsAt || s.endsAt ? `${s.startsAt ? `from ${s.startsAt.slice(0, 10)} ` : ""}${s.endsAt ? `until ${s.endsAt.slice(0, 10)}` : ""}`.trim() : "No end date set");

/** Suggestions for the search box: real product names and category names that contain what was typed. */
export function suggestions(q: string, products: StoreProduct[], categories: CategoryNode[], limit = 6): { kind: "product" | "category"; text: string; slug?: string; id?: string }[] {
  const t = q.trim().toLowerCase(); if (t.length < 2) return [];
  const cats = categories.filter((c) => c.published && c.name.toLowerCase().includes(t)).slice(0, 2).map((c) => ({ kind: "category" as const, text: c.name, id: c.id }));
  const prods = products.filter((p) => p.name.toLowerCase().includes(t) || sku(p).toLowerCase() === t).slice(0, limit - cats.length).map((p) => ({ kind: "product" as const, text: p.name, slug: p.slug }));
  return [...cats, ...prods];
}
