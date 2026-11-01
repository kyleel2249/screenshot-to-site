import { describe, expect, test } from "vitest";
import { SEED_CATEGORIES } from "../lib/domain/categories";
import { comparisonRows, DEFAULT_FILTERS, filterProducts, isModule, MODULES, newArrivals, orderBucket, progressIndex, sortProducts, suggestions, toMinor, topCategories } from "../lib/dashboard-lib";
import type { StoreProduct } from "../lib/storefront";

const CAT = "cat-shoes-and-footwear--sneakers";
const mk = (slug: string, o: Partial<StoreProduct> = {}): StoreProduct => ({
  slug, name: slug.toUpperCase(), categoryId: CAT, createdAt: "2026-01-01T00:00:00Z", shortDescription: `about ${slug}`, image: "/i.jpg", imageAlt: "a",
  availability: "available", labels: [], price: { GHS: 10000, USD: 1000 }, salePrice: null, variantId: `p::${slug}`, attributes: {}, ...o,
});
const cats = SEED_CATEGORIES;
const list = [
  mk("a", { price: { GHS: 5000 }, attributes: { brand: "Nike", model: "Air" }, labels: ["featured"] }),
  mk("b", { price: { GHS: 20000, USD: 2000 }, createdAt: "2026-03-01T00:00:00Z", rating: { count: 3, average: 4.5 }, labels: ["best_seller"] }),
  mk("c", { price: {}, availability: "coming_soon" }),
  mk("d", { price: { GHS: 10000 }, salePrice: { GHS: 8000 }, availability: "out_of_stock", attributes: { brand: "Adidas" } }),
];

describe("navigation", () => {
  test("all 22 requested modules exist, are unique and recognised", () => {
    expect(MODULES).toHaveLength(22); expect(new Set(MODULES.map((m) => m.id)).size).toBe(22);
    expect(isModule("orders")).toBe(true); expect(isModule("admin")).toBe(false); expect(isModule(undefined)).toBe(false);
  });
});
describe("filtering", () => {
  test("toMinor uses integer maths and rejects junk", () => {
    expect(toMinor("12.5")).toBe(1250); expect(toMinor("0.05")).toBe(5); expect(toMinor("100")).toBe(10000); expect(toMinor("-1")).toBeUndefined(); expect(toMinor("1e3")).toBeUndefined(); expect(toMinor("")).toBeUndefined();
  });
  test("search covers name, SKU, description, brand/model attributes and category", () => {
    const f = (q: string) => filterProducts(list, { ...DEFAULT_FILTERS, q }, cats).map((p) => p.slug);
    expect(f("nike air")).toEqual(["a"]); expect(f("about c")).toEqual(["c"]); expect(f("sneakers")).toEqual(["a", "b", "c", "d"]); expect(f("zzz")).toEqual([]);
  });
  test("price bounds apply in the chosen currency; products with no price there are excluded, not guessed", () => {
    const f = (o: Partial<typeof DEFAULT_FILTERS>) => filterProducts(list, { ...DEFAULT_FILTERS, ...o }, cats).map((p) => p.slug);
    expect(f({ min: "60", max: "150" })).toEqual(["d"]); // d's sale price 80.00 counts; a is 50.00
    expect(f({ currency: "USD", min: "5" })).toEqual(["b"]); // only b has an approved USD price
    expect(f({ min: "1" })).not.toContain("c");
  });
  test("availability, promo, brand and rating filters", () => {
    const f = (o: Partial<typeof DEFAULT_FILTERS>) => filterProducts(list, { ...DEFAULT_FILTERS, ...o }, cats).map((p) => p.slug);
    expect(f({ availability: "buyable" })).toEqual(["a", "b"]); expect(f({ availability: "out_of_stock" })).toEqual(["d"]);
    expect(f({ onlyPromo: true })).toEqual(["d"]); expect(f({ brand: "Nike" })).toEqual(["a"]); expect(f({ minRating: 4 })).toEqual(["b"]);
  });
});
describe("sorting never fabricates", () => {
  const s = (sort: Parameters<typeof sortProducts>[1], popular: string[] = []) => sortProducts(list, sort, "GHS", { popular }).map((p) => p.slug);
  test("price sorts put unpriced products last in both directions", () => {
    expect(s("price-asc")).toEqual(["a", "d", "b", "c"]); expect(s("price-desc").slice(0, 3)).toEqual(["b", "d", "a"]); expect(s("price-desc").at(-1)).toBe("c");
  });
  test("rating sort: genuine ratings first, unrated after; popularity only from supplied sales ranking", () => {
    expect(s("rated")[0]).toBe("b"); expect(s("popular", ["d", "a"]).slice(0, 2)).toEqual(["d", "a"]); expect(s("best")[0]).toBe("b"); expect(s("featured")[0]).toBe("a");
  });
});
describe("sections", () => {
  test("new arrivals fall back to newest and say so", () => {
    expect(newArrivals(list).labelled).toBe(false); expect(newArrivals(list).items[0]!.slug).toBe("b");
    expect(newArrivals([mk("n", { labels: ["new_arrival"] }), mk("o")]).labelled).toBe(true);
  });
  test("category counts come from real products", () => {
    const t = topCategories(list, cats); expect(t.reduce((n, c) => n + c.count, 0)).toBe(4); expect(t.find((c) => c.count === 4)).toBeTruthy();
  });
  test("comparison shows only provided values; absent ones are null", () => {
    const rows = comparisonRows([list[0]!, list[3]!]);
    expect(rows.find((r) => r.key === "brand")!.values).toEqual(["Nike", "Adidas"]); expect(rows.find((r) => r.key === "model")!.values).toEqual(["Air", null]);
  });
  test("suggestions are real names/categories only", () => {
    expect(suggestions("a", list, cats)).toEqual([]); expect(suggestions("sneak", list, cats).some((x) => x.kind === "category")).toBe(true);
    expect(suggestions("B", list, cats)).toEqual([]); expect(suggestions("nike", list, cats)).toEqual([]);
  });
});
describe("orders", () => {
  test("progress and buckets", () => {
    expect(progressIndex("pending_payment")).toBe(0); expect(progressIndex("in_transit")).toBe(3); expect(progressIndex("delivered")).toBe(4); expect(progressIndex("cancelled")).toBe(-1);
    expect(orderBucket("pending_payment")).toBe("pending"); expect(orderBucket("processing")).toBe("active"); expect(orderBucket("delivered")).toBe("completed"); expect(orderBucket("refunded")).toBe("closed");
  });
});
