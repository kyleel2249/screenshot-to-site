import { describe, expect, it } from "vitest";
import { categories, products, productsIn, viewOf, getVariantMap, displayPrice } from "@/lib/catalog";
import { addLine, quote } from "@/lib/cart-core";

describe("catalog seed integrity", () => {
  it("every product references a real category and has unique slug/variant ids", () => {
    const ids = new Set(categories.map((c) => c.id));
    for (const p of products) expect(ids.has(p.categoryId), p.slug).toBe(true);
    expect(new Set(products.map((p) => p.slug)).size).toBe(products.length);
    expect(getVariantMap().size).toBe(products.length);
  });
  it("parent categories include child products", () => {
    expect(productsIn("cat-phones-and-accessories").length).toBeGreaterThan(1);
  });
  it("demo data is labelled as demo", () => { for (const p of products) expect(p.name).toContain("(Demo)"); });
  it("unpurchasable statuses never appear as available", () => {
    expect(viewOf(products.find((p) => p.slug === "ring-light-26")!).availability).toBe("out_of_stock");
    expect(viewOf(products.find((p) => p.slug === "travel-backpack")!).availability).toBe("coming_soon");
    expect(viewOf(products.find((p) => p.slug === "old-model-kettle")!).labels).toEqual([]);
  });
  it("shows both independently-set prices in dual mode without an exchange rate", () => {
    const p = products.find((x) => x.slug === "leather-tote")!;
    expect(displayPrice(p, "DUAL").current.map((c) => c.text)).toEqual(["GH₵ 980.00", "US$ 63.00"]);
  });
});

describe("cart", () => {
  it("adds quantity to an existing line", () => {
    expect(addLine([{ variantId: "leather-tote-default", qty: 1 }], "leather-tote-default")).toEqual([{ variantId: "leather-tote-default", qty: 2 }]);
  });
  it("re-prices server-side in integer minor units", () => {
    const r = quote([{ variantId: "leather-tote-default", qty: 2 }, { variantId: "everyday-sneakers-default", qty: 1 }], "GHS");
    expect(r.ok && r.cart.total.amount).toBe(252000);
  });
  it("refuses out-of-stock and over-stock quantities", () => {
    expect(quote([{ variantId: "ring-light-26-default", qty: 1 }], "GHS").ok).toBe(false);
    expect(quote([{ variantId: "power-bank-20k-default", qty: 4 }], "GHS").ok).toBe(false);
  });
  it("applies the active sale price", () => {
    const r = quote([{ variantId: "smartwatch-series-default", qty: 1 }], "USD");
    expect(r.ok && r.cart.total.amount).toBe(9500);
    expect(r.ok && r.cart.hasPreorder).toBe(true);
  });
});
