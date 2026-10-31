import { describe, expect, test } from "vitest";
import { money, formatMoney, convert, parseMajor, priceLabels, percentOf, add } from "../lib/domain/money";
import { SEED_CATEGORIES, topLevel, childrenOf, descendantIds, addCategory, reorder, setPublished, renameCategory, breadcrumb } from "../lib/domain/categories";
import { canPurchase, effectiveAvailability, activePromoLabels, normalizeLabels, type Sellable } from "../lib/domain/status";
import { priceCart, applyPaymentEvent, canTransition, transition, activeUnitPrice, type VariantRecord, type Discount, type ShippingZone } from "../lib/domain/commerce";

const rate = { ghsPerUsdMicro: 15_500_000, source: "Owner-set", effectiveDate: "2026-10-29" };

describe("money", () => {
  test("integer-only and formatting", () => {
    expect(() => money(1.5, "GHS")).toThrow();
    expect(formatMoney(money(123456, "GHS"))).toBe("GH₵ 1,234.56");
    expect(formatMoney(money(5, "USD"))).toBe("US$ 0.05");
    expect(parseMajor("19.9")).toBe(1990);
  });
  test("no float drift", () => { expect(add(money(10, "GHS"), money(20, "GHS")).amount).toBe(30); expect(percentOf(money(1999, "GHS"), 1000).amount).toBe(200); });
  test("currency mismatch rejected", () => { expect(() => add(money(1, "GHS"), money(1, "USD"))).toThrow(); });
  test("conversion requires documented rate", () => {
    expect(convert(money(10000, "USD"), "GHS", rate).amount).toBe(155000);
    expect(convert(money(155000, "GHS"), "USD", rate).amount).toBe(10000);
    expect(() => convert(money(1, "USD"), "GHS", { ...rate, source: "" })).toThrow();
  });
  test("display modes; independent prices are not overwritten by conversion", () => {
    const p = { GHS: 100000, USD: 6000 };
    expect(priceLabels(p, "GHS", rate)).toEqual([{ text: "GH₵ 1,000.00", note: undefined }]);
    expect(priceLabels(p, "USD", rate)[0].text).toBe("US$ 60.00");
    const dual = priceLabels(p, "DUAL", rate);
    expect(dual.length).toBe(2); expect(dual.every((d) => d.note === undefined)).toBe(true);
    const conv = priceLabels({ GHS: 155000 }, "DUAL", rate);
    expect(conv[1].text).toBe("US$ 100.00"); expect(conv[1].note).toContain("Owner-set");
    expect(priceLabels({ GHS: 100 }, "USD")).toEqual([]); // no rate => never invented
  });
});

describe("categories", () => {
  test("all 15 top-level groups seeded with required children", () => {
    const top = topLevel(SEED_CATEGORIES);
    expect(top.map((t) => t.name)).toEqual(["Cars", "Household & Kitchen", "Clothing & Fashion", "Shoes & Footwear", "Phones & Accessories", "Gift Sets", "Jewellery", "Teas, Gummies & Supplements", "Bags & Luggage", "Toiletries & Personal Care Essentials", "Hair & Hair Accessories", "Equipment, Medical Equipment & Farm Tools", "Cosmetics & Fragrances", "Building Materials & Fixtures", "Other Products"]);
    const kids = (n: string) => childrenOf(SEED_CATEGORIES, top.find((t) => t.name === n)!.id).map((c) => c.name);
    expect(kids("Cars")).toEqual(["SUVs", "Saloon Cars"]);
    expect(kids("Clothing & Fashion").length).toBe(13);
    expect(kids("Shoes & Footwear")).toContain("Flip-flops");
    expect(kids("Teas, Gummies & Supplements")).toEqual(["Fibroid Tea Products", "Slimming Tea", "Flat Tummy Tea", "Gummies", "Supplements"]);
    expect(kids("Building Materials & Fixtures")).toContain("Water Closets (WC)");
  });
  test("slugs and ids are unique despite repeated names", () => {
    expect(new Set(SEED_CATEGORIES.map((c) => c.slug)).size).toBe(SEED_CATEGORIES.length);
    expect(new Set(SEED_CATEGORIES.map((c) => c.id)).size).toBe(SEED_CATEGORIES.length);
  });
  test("vehicle and footwear use specific filter profiles", () => {
    expect(SEED_CATEGORIES.find((c) => c.name === "SUVs")!.filterProfile).toBe("vehicle");
    expect(SEED_CATEGORIES.find((c) => c.name === "Sneakers")!.filterProfile).toBe("footwear");
  });
  test("admin ops: add, rename, hide, reorder", () => {
    let c = addCategory(SEED_CATEGORIES, { name: "Pet Supplies", parentId: null });
    const pet = c.find((x) => x.name === "Pet Supplies")!;
    expect(pet.published).toBe(true);
    c = renameCategory(c, pet.id, "Pets");
    c = setPublished(c, pet.id, false);
    expect(topLevel(c).some((x) => x.id === pet.id)).toBe(false);
    c = reorder(c, "cat-jewellery", 0);
    expect(topLevel(c)[0].name).toBe("Jewellery");
    expect(descendantIds(SEED_CATEGORIES, "cat-cars").length).toBe(3);
    expect(breadcrumb(SEED_CATEGORIES, "cat-cars--suvs").map((b) => b.name)).toEqual(["Cars", "SUVs"]);
  });
});

const base = (o: Partial<Sellable> = {}): Sellable => ({ availability: "available", trackInventory: true, onHand: 5, reserved: 0, allowBackorder: false, published: true, ...o });

describe("product status rules", () => {
  test("available respects stock and prevents overselling", () => {
    expect(canPurchase(base(), 5).ok).toBe(true);
    expect(canPurchase(base(), 6)).toEqual({ ok: false, reason: "Only 5 available." });
    expect(canPurchase(base({ reserved: 5 }), 1).ok).toBe(false);
  });
  test("out of stock cannot be bought unless backorder", () => {
    expect(canPurchase(base({ availability: "out_of_stock" }), 1).ok).toBe(false);
    expect(canPurchase(base({ availability: "out_of_stock", allowBackorder: true }), 1)).toMatchObject({ ok: true, mode: "backorder" });
  });
  test("preorder needs explicit enablement and honours allocation", () => {
    expect(canPurchase(base({ availability: "pre_order" }), 1).ok).toBe(false);
    expect(canPurchase(base({ availability: "pre_order", preOrder: { enabled: true, limit: 3, sold: 2 } }), 2).ok).toBe(false);
    expect(canPurchase(base({ availability: "pre_order", preOrder: { enabled: true, expectedWindow: "TBC" } }), 2)).toMatchObject({ ok: true, mode: "preorder" });
  });
  test("coming soon / unavailable / discontinued / unpublished / scheduled are blocked", () => {
    for (const a of ["coming_soon", "temporarily_unavailable", "discontinued"] as const) expect(canPurchase(base({ availability: a }), 1).ok).toBe(false);
    expect(canPurchase(base({ published: false }), 1).ok).toBe(false);
    expect(canPurchase(base({ publishAt: "2999-01-01T00:00:00Z" }), 1).ok).toBe(false);
  });
  test("tracked 'available' with zero stock displays as out of stock", () => { expect(effectiveAvailability(base({ onHand: 0 }))).toBe("out_of_stock"); });
  test("labels: expiry, honest scarcity/sale, never on unpurchasable", () => {
    const s = base({ onHand: 2 });
    const now = new Date("2026-06-01T00:00:00Z");
    const l = activePromoLabels([{ label: "just_landed", endsAt: "2026-05-01T00:00:00Z" }, { label: "limited_stock" }, { label: "on_sale" }, { label: "featured" }], s, { showLimitedBelow: 3, hasValidSale: false }, now);
    expect(l).toContain("limited_stock"); expect(l).toContain("featured"); expect(l).not.toContain("just_landed"); expect(l).not.toContain("on_sale");
    expect(activePromoLabels([{ label: "featured" }], base({ onHand: 0 }), {}, now)).toEqual([]);
    expect(activePromoLabels([{ label: "limited_stock" }], base({ trackInventory: false }), { showLimitedBelow: 9 }, now)).toEqual([]);
    expect(normalizeLabels(["just_landed", "new_arrival"])).toEqual(["just_landed"]);
  });
});

const V = (id: string, o: Partial<VariantRecord> = {}): VariantRecord => ({ id, productId: "p-" + id, name: "Item " + id, price: { GHS: 10000, USD: 700 }, weightGrams: 500, categoryIds: ["cat-cars"], ...base(), ...o });
const zone: ShippingZone = { id: "z1", name: "Accra", regions: ["Greater Accra"], currency: "GHS", baseFee: 2000, perKgFee: 500, freeOver: 50000, estimate: "1–3 working days (estimate)" };
const code = (o: Partial<Discount> = {}): Discount => ({ code: "SAVE10", kind: "percent", value: 1000, redeemed: 0, active: true, ...o });

describe("pricing, discounts, shipping", () => {
  const variants = new Map([["a", V("a")], ["b", V("b", { availability: "out_of_stock" })], ["c", V("c", { availability: "pre_order", preOrder: { enabled: true } })]]);
  test("server prices from records, ignoring any client price", () => {
    const r = priceCart({ lines: [{ variantId: "a", qty: 2 }], currency: "GHS" }, variants, { zone, region: "Greater Accra" });
    expect(r.ok && r.cart.subtotal.amount).toBe(20000);
    expect(r.ok && r.cart.shipping.amount).toBe(2500);
    expect(r.ok && r.cart.total.amount).toBe(22500);
  });
  test("fails closed on unpurchasable lines and missing currency", () => {
    expect(priceCart({ lines: [{ variantId: "b", qty: 1 }], currency: "GHS" }, variants, {}).ok).toBe(false);
    expect(priceCart({ lines: [{ variantId: "a", qty: 99 }], currency: "GHS" }, variants, {}).ok).toBe(false);
    const ghsOnly = new Map([["g", V("g", { price: { GHS: 100 } })]]);
    expect(priceCart({ lines: [{ variantId: "g", qty: 1 }], currency: "USD" }, ghsOnly, {}).ok).toBe(false);
  });
  test("preorders flagged in mixed carts", () => {
    const r = priceCart({ lines: [{ variantId: "a", qty: 1 }, { variantId: "c", qty: 1 }], currency: "GHS" }, variants, {});
    expect(r.ok && r.cart.hasPreorder).toBe(true);
  });
  test("sale price honours window", () => {
    const v = V("s", { salePrice: { GHS: 8000 }, saleStartsAt: "2026-01-01T00:00:00Z", saleEndsAt: "2026-02-01T00:00:00Z" });
    expect(activeUnitPrice(v, "GHS", new Date("2026-01-15T00:00:00Z"))!.amount).toBe(8000);
    expect(activeUnitPrice(v, "GHS", new Date("2026-03-01T00:00:00Z"))!.amount).toBe(10000);
  });
  test("discount rules", () => {
    const run = (d: Discount | undefined, customer = { priorOrders: 0, redemptionsByCode: {} as Record<string, number> }, c: "GHS" | "USD" = "GHS") =>
      priceCart({ lines: [{ variantId: "a", qty: 1 }], currency: c, discountCode: "save10" }, variants, { discounts: new Map(d ? [[d.code, d]] : []), customer });
    const ok = run(code()); expect(ok.ok && ok.cart.discount.amount).toBe(1000);
    expect(run(undefined).ok).toBe(false);
    expect(run(code({ endsAt: "2020-01-01T00:00:00Z" })).ok).toBe(false);
    expect(run(code({ maxRedemptions: 1, redeemed: 1 })).ok).toBe(false);
    expect(run(code({ perCustomerLimit: 1 }), { priorOrders: 1, redemptionsByCode: { SAVE10: 1 } }).ok).toBe(false);
    expect(run(code({ firstPurchaseOnly: true }), { priorOrders: 2, redemptionsByCode: {} }).ok).toBe(false);
    expect(run(code({ eligibleCurrencies: ["USD"] })).ok).toBe(false);
    expect(run(code({ kind: "fixed", value: 500, currency: "USD" })).ok).toBe(false);
    expect(run(code({ minSubtotal: 999999 })).ok).toBe(false);
    const fs = priceCart({ lines: [{ variantId: "a", qty: 1 }], currency: "GHS", discountCode: "SAVE10" }, variants, { discounts: new Map([["SAVE10", code({ kind: "free_shipping", value: 0 })]]), zone, region: "Greater Accra" });
    expect(fs.ok && fs.cart.shipping.amount).toBe(0);
  });
  test("undeliverable regions and free-shipping threshold", () => {
    expect(priceCart({ lines: [{ variantId: "a", qty: 1 }], currency: "GHS" }, variants, { zone, region: "Nowhere" }).ok).toBe(false);
    const big = new Map([["big", V("big", { onHand: 50 })]]);
    const r = priceCart({ lines: [{ variantId: "big", qty: 6 }], currency: "GHS" }, big, { zone, region: "Greater Accra" });
    expect(r.ok && r.cart.shipping.amount).toBe(0);
  });
});

describe("order state machine and payments", () => {
  test("transitions", () => {
    expect(canTransition("pending_payment", "payment_confirmed")).toBe(true);
    expect(canTransition("pending_payment", "delivered")).toBe(false);
    expect(() => transition("cancelled", "processing")).toThrow();
  });
  const order = { ref: "DDT-1", total: 22500, currency: "GHS" as const, status: "pending_payment" as const, processedEvents: [] as string[] };
  test("verified success marks paid exactly once", () => {
    const r = applyPaymentEvent(order, { eventId: "e1", orderRef: "DDT-1", amount: 22500, currency: "GHS", status: "success" });
    expect(r.kind === "applied" && r.order.status).toBe("payment_confirmed");
    if (r.kind === "applied") expect(applyPaymentEvent(r.order, { eventId: "e1", orderRef: "DDT-1", amount: 22500, currency: "GHS", status: "success" }).kind).toBe("duplicate");
  });
  test("amount/currency mismatch never marks paid; failed events don't", () => {
    const m = applyPaymentEvent(order, { eventId: "e2", orderRef: "DDT-1", amount: 100, currency: "GHS", status: "success" });
    expect(m.kind === "applied" && m.order.status).toBe("payment_under_review");
    const c = applyPaymentEvent(order, { eventId: "e3", orderRef: "DDT-1", amount: 22500, currency: "USD", status: "success" });
    expect(c.kind === "applied" && c.order.status).toBe("payment_under_review");
    expect(applyPaymentEvent(order, { eventId: "e4", orderRef: "DDT-1", amount: 22500, currency: "GHS", status: "failed" }).kind).toBe("ignored");
    expect(applyPaymentEvent(order, { eventId: "e5", orderRef: "OTHER", amount: 22500, currency: "GHS", status: "success" }).kind).toBe("mismatch");
  });
});
