/**
 * Product recommendations. Deliberately simple, explainable and honest:
 *  - a rule-based scoring engine over the REAL catalogue and the visitor's OWN session signals
 *    (recently viewed, wishlist, cart, comparison, searches, stated interests);
 *  - popularity and "bought together" come only from genuine paid orders, and are omitted until enough real sales exist;
 *  - there is no external AI service: nothing about a visitor leaves the server, and no purchase history is assumed for guests.
 * Pure functions (no I/O) so they are unit-tested.
 */
import type { CategoryNode } from "./domain/categories";
import type { RecSection } from "./guest-types";

export interface RecProduct { slug: string; name: string; categoryId: string; createdAt: string; availability: string; attributes: Record<string, string>; shortDescription?: string }
export interface RecSignals { viewed: string[]; wishlist: string[]; cart: string[]; compare: string[]; searches: string[]; interests: string[] }
/** Aggregates over paid orders only. Counts never leave the server; only the resulting ORDER does. */
export interface SalesData { bySlug: Record<string, number>; recentBySlug: Record<string, number>; pairs: Record<string, Record<string, number>> }
export const NO_SALES: SalesData = { bySlug: {}, recentBySlug: {}, pairs: {} };
export const NO_SIGNALS: RecSignals = { viewed: [], wishlist: [], cart: [], compare: [], searches: [], interests: [] };

/** A product pair must have been bought together this many times before it is suggested. */
export const MIN_PAIR_COUNT = 2;

const purchasable = (p: RecProduct) => p.availability === "available" || p.availability === "pre_order";

function rootOf(categories: CategoryNode[], id: string): string {
  const byId = new Map(categories.map((c) => [c.id, c]));
  let cur = byId.get(id), guard = 0;
  while (cur?.parentId && guard++ < 5) cur = byId.get(cur.parentId);
  return cur?.id ?? id;
}

/** How related two products are: same subcategory > same top-level group, plus shared attribute values (brand, make, colour…). */
export function relatedness(a: RecProduct, b: RecProduct, categories: CategoryNode[]): number {
  if (a.slug === b.slug) return 0;
  let s = 0;
  if (a.categoryId === b.categoryId) s += 3;
  else if (rootOf(categories, a.categoryId) === rootOf(categories, b.categoryId)) s += 1.5;
  if (s === 0) return 0; // unrelated groups never match on attributes alone
  for (const [k, v] of Object.entries(a.attributes)) if (v && b.attributes[k] === v) s += 0.75;
  return s;
}

const tokens = (xs: string[]) => [...new Set(xs.flatMap((x) => x.toLowerCase().split(/[^a-z0-9]+/)).filter((t) => t.length >= 3))];

export function recommend(products: RecProduct[], categories: CategoryNode[], signals: RecSignals, sales: SalesData, opts: { focus?: string; limit?: number } = {}): RecSection[] {
  const limit = opts.limit ?? 8;
  const bySlug = new Map(products.map((p) => [p.slug, p]));
  const pool = products.filter(purchasable);
  const sections: RecSection[] = [];
  const recent = (s: string) => sales.recentBySlug[s] ?? 0;
  const newest = (a: RecProduct, b: RecProduct) => b.createdAt.localeCompare(a.createdAt);
  const take = (xs: RecProduct[]) => xs.slice(0, limit).map((p) => p.slug);

  const focus = opts.focus ? bySlug.get(opts.focus) : undefined;
  if (focus) {
    const similar = pool.map((p) => ({ p, s: relatedness(focus, p, categories) })).filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || recent(b.p.slug) - recent(a.p.slug) || newest(a.p, b.p)).map((x) => x.p);
    if (similar.length) sections.push({ id: "similar", title: "Similar products", slugs: take(similar) });
    const together = Object.entries(sales.pairs[focus.slug] ?? {}).filter(([, n]) => n >= MIN_PAIR_COUNT).sort((a, b) => b[1] - a[1])
      .map(([slug]) => bySlug.get(slug)).filter((p): p is RecProduct => !!p && purchasable(p));
    if (together.length) sections.push({ id: "bought_together", title: "Frequently bought together", slugs: take(together) });
    const trendingHere = pool.filter((p) => p.categoryId === focus.categoryId && p.slug !== focus.slug && recent(p.slug) > 0).sort((a, b) => recent(b.slug) - recent(a.slug));
    if (trendingHere.length) sections.push({ id: "trending", title: "Trending in this category", slugs: take(trendingHere) });
  }

  // Personal ("you may also like"): built only from this visitor's own signals.
  const seeds: { p: RecProduct; w: number }[] = [];
  const add = (slugs: string[], w: (i: number) => number) => slugs.forEach((s, i) => { const p = bySlug.get(s); if (p) seeds.push({ p, w: w(i) }); });
  add(signals.wishlist, () => 3); add(signals.cart, () => 3); add(signals.compare, () => 2); add(signals.viewed, (i) => 2 / (1 + i * 0.25));
  const known = new Set([...signals.wishlist, ...signals.cart, ...signals.compare, ...signals.viewed, ...(focus ? [focus.slug] : [])]);
  const words = tokens([...signals.searches, ...signals.interests]);
  const personal = pool.filter((p) => !known.has(p.slug)).map((p) => {
    let s = seeds.reduce((acc, seed) => acc + seed.w * relatedness(seed.p, p, categories), 0);
    const hay = `${p.name} ${p.shortDescription ?? ""}`.toLowerCase();
    s += Math.min(3, words.filter((w) => hay.includes(w)).length * 1.5);
    return { p, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || recent(b.p.slug) - recent(a.p.slug) || newest(a.p, b.p)).map((x) => x.p);
  if (personal.length) sections.push({ id: "for_you", title: "You may also like", slugs: take(personal) });

  if (!focus) {
    const popular = pool.filter((p) => (sales.bySlug[p.slug] ?? 0) > 0).sort((a, b) => (sales.bySlug[b.slug] ?? 0) - (sales.bySlug[a.slug] ?? 0) || newest(a, b));
    if (popular.length) sections.push({ id: "popular", title: "Popular with shoppers", slugs: take(popular) });
    const trending = pool.filter((p) => recent(p.slug) > 0).sort((a, b) => recent(b.slug) - recent(a.slug));
    if (trending.length) sections.push({ id: "trending", title: "Trending this month", slugs: take(trending) });
  }
  return sections;
}
