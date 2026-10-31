import { describe, expect, it } from "vitest";
import { SEED_CATEGORIES as categories } from "@/lib/domain/categories";
import { business } from "@/lib/catalog";
import { addLine } from "@/lib/cart-core";
import { canAdd, cheapestGhs, displayPrice, estimate, productsIn, search, sortProducts, type StoreProduct } from "@/lib/storefront";

const p = (o: Partial<StoreProduct> & { slug: string }): StoreProduct => ({
  name: o.slug, categoryId: "cat-phones-and-accessories--power-banks", createdAt: "2026-10-01T00:00:00Z", shortDescription: "s", image: "/i.jpg", imageAlt: "a",
  availability: "available", labels: [], price: { GHS: 10000, USD: 700 }, salePrice: null, variantId: `${o.slug}::SKU-${o.slug}`, ...o,
});
const list = [
  p({ slug: "tote", price: { GHS: 98000, USD: 6300 }, createdAt: "2026-10-05T00:00:00Z" }),
  p({ slug: "watch", availability: "pre_order", price: { GHS: 165000, USD: 10500 }, salePrice: { GHS: 150000, USD: 9500 }, labels: ["on_sale"] }),
  p({ slug: "light", availability: "out_of_stock" }),
  p({ slug: "bank", remaining: 3, categoryId: "cat-phones-and-accessories--power-banks" }),
];

describe("storefront helpers", () => {
  it("reference data is intact", () => { expect(categories.length).toBeGreaterThan(14); expect(business.name).toBe("Dera Darko Trade"); });
  it("parent categories include child products", () => { expect(productsIn(list, categories, "cat-phones-and-accessories").length).toBe(4); expect(productsIn(list, categories, "cat-bags-and-luggage").length).toBe(0); });
  it("search by name or SKU; sort by price and newest", () => {
    expect(search(list, "TOTE").map((x) => x.slug)).toEqual(["tote"]);
    expect(search(list, "sku-bank").map((x) => x.slug)).toEqual(["bank"]);
    expect(sortProducts(list, "price-asc").map((x) => x.slug)[0]).toBe("light");
    expect(sortProducts(list, "price-desc")[0]!.slug).toBe("watch");
    expect(sortProducts(list, undefined)[0]!.slug).toBe("tote");
    expect(cheapestGhs(p({ slug: "u", price: { USD: 1 } }))).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("shows both independently set prices in dual mode and never converts without a rate", () => {
    expect(displayPrice(list[0]!, "DUAL").current.map((c) => c.text)).toEqual(["GH₵ 980.00", "US$ 63.00"]);
    const w = displayPrice(list[1]!, "GHS"); expect(w.current[0]!.text).toBe("GH₵ 1,500.00"); expect(w.original[0]!.text).toBe("GH₵ 1,650.00");
    expect(displayPrice(p({ slug: "g", price: { GHS: 100 } }), "USD").current).toEqual([]);
  });
  it("add-to-cart guard: unavailable, unpurchasable, over the limited remaining", () => {
    expect(canAdd(undefined, 1).ok).toBe(false);
    expect(canAdd(list[2], 1)).toEqual({ ok: false, reason: "Out of stock." });
    expect(canAdd(list[3], 3).ok).toBe(true); expect(canAdd(list[3], 4)).toEqual({ ok: false, reason: "Only 3 left." });
  });
});

describe("cart estimate", () => {
  it("adds quantity to an existing line", () => { expect(addLine([{ variantId: "a", qty: 1 }], "a")).toEqual([{ variantId: "a", qty: 2 }]); });
  it("prices in integer minor units using the active sale price and flags pre-orders", () => {
    const r = estimate([{ variantId: list[0]!.variantId, qty: 2 }, { variantId: list[1]!.variantId, qty: 1 }], list, "GHS");
    expect(r.ok && r.subtotal.amount).toBe(2 * 98000 + 150000); expect(r.ok && r.hasPreorder).toBe(true);
    const u = estimate([{ variantId: list[1]!.variantId, qty: 1 }], list, "USD"); expect(u.ok && u.subtotal.amount).toBe(9500);
  });
  it("refuses removed, unpurchasable, over-limit and wrong-currency lines with clear errors", () => {
    const bad = estimate([{ variantId: "gone", qty: 1 }, { variantId: list[2]!.variantId, qty: 1 }, { variantId: list[3]!.variantId, qty: 9 }], list, "GHS");
    expect(bad.ok).toBe(false); expect(!bad.ok && bad.errors.length).toBe(3);
    expect(estimate([{ variantId: list[0]!.variantId, qty: 1 }], [p({ slug: "tote", price: { GHS: 1 } })], "USD").ok).toBe(false);
    expect(estimate([], list, "GHS").ok).toBe(false);
  });
});
