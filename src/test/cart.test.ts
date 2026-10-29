import { describe, it, expect } from "vitest";
import { addLine, cartTotal } from "@/lib/cart";

describe("cart", () => {
  it("adds quantity to an existing line", () => {
    expect(addLine([{ slug: "leather-tote", qty: 1 }], "leather-tote")).toEqual([{ slug: "leather-tote", qty: 2 }]);
  });
  it("totals in GHS from catalogue prices", () => {
    expect(cartTotal([{ slug: "leather-tote", qty: 2 }, { slug: "everyday-sneakers", qty: 1 }])).toBe(2520);
  });
});
