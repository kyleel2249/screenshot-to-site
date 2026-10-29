import { describe, expect, it } from "vitest";
import { campaignFrom, eventKindFor, isMeasurable } from "@/lib/analytics-client";

describe("analytics client rules", () => {
  it("measures only public shop pages — never the dashboard, account, auth or tracking pages", () => {
    for (const ok of ["/", "/shop", "/product/blue-cap", "/policies/privacy", "/checkout", "/deals"]) expect(isMeasurable(ok), ok).toBe(true);
    for (const no of ["/ops-k7q2m9x4p1z8", "/account", "/login", "/register", "/reset-password", "/verify-email", "/track", "/cart", "/product/a/b", "/anything-else-entirely"]) expect(isMeasurable(no), no).toBe(false);
  });
  it("maps paths to a single allowed event kind", () => {
    expect(eventKindFor("/product/x")).toBe("product_view"); expect(eventKindFor("/shop")).toBe("category_view");
    expect(eventKindFor("/checkout")).toBe("checkout_start"); expect(eventKindFor("/about")).toBe("page_view");
  });
  it("reads trimmed UTM attribution and omits absent values", () => {
    expect(campaignFrom("?utm_source=fb&utm_campaign=eid")).toEqual({ source: "fb", campaign: "eid" });
    expect(campaignFrom("?x=1")).toEqual({}); expect(campaignFrom("?utm_source=" + "a".repeat(100)).source).toHaveLength(60);
  });
});
