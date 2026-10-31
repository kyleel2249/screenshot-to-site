/**
 * Public-facing product status system. The database is the source of truth; nothing here is hardcoded per product.
 * `availability` is the single authoritative purchasing state. Promotional labels are separate and
 * can NEVER make an unpurchasable item purchasable.
 */
export type Availability =
  | "available"
  | "pre_order"
  | "out_of_stock"
  | "coming_soon"
  | "temporarily_unavailable"
  | "discontinued";

export type PromoLabel = "featured" | "just_landed" | "new_arrival" | "best_seller" | "limited_stock" | "on_sale";

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  available: "Available",
  pre_order: "Pre-order",
  out_of_stock: "Out of stock",
  coming_soon: "Coming soon",
  temporarily_unavailable: "Temporarily unavailable",
  discontinued: "Discontinued",
};

export const PROMO_LABEL: Record<PromoLabel, string> = {
  featured: "Featured",
  just_landed: "Just landed",
  new_arrival: "New arrival",
  best_seller: "Best seller",
  limited_stock: "Limited stock",
  on_sale: "On sale",
};

export interface Sellable {
  availability: Availability;
  trackInventory: boolean;
  onHand: number;
  reserved: number;
  allowBackorder: boolean;
  preOrder?: { enabled: boolean; expectedWindow?: string; limit?: number; sold?: number };
  published: boolean;
  publishAt?: string; // ISO
}

export const sellableQty = (s: Sellable) => Math.max(0, s.onHand - s.reserved);

export type PurchaseDecision = { ok: true; mode: "stock" | "preorder" | "backorder"; maxQty: number | null } | { ok: false; reason: string };

/** The single rule used by cart, checkout and the server. */
export function canPurchase(s: Sellable, qty: number, now = new Date()): PurchaseDecision {
  if (!Number.isInteger(qty) || qty < 1) return { ok: false, reason: "Quantity must be at least 1." };
  if (!s.published || (s.publishAt && new Date(s.publishAt) > now)) return { ok: false, reason: "This product is not published." };
  switch (s.availability) {
    case "coming_soon": return { ok: false, reason: "Coming soon — not yet purchasable." };
    case "temporarily_unavailable": return { ok: false, reason: "Temporarily unavailable." };
    case "discontinued": return { ok: false, reason: "This product has been discontinued." };
    case "pre_order": {
      if (!s.preOrder?.enabled) return { ok: false, reason: "Pre-orders are not enabled for this product." };
      if (s.preOrder.limit !== undefined) {
        const left = Math.max(0, s.preOrder.limit - (s.preOrder.sold ?? 0));
        if (qty > left) return { ok: false, reason: left === 0 ? "Pre-order allocation is full." : `Only ${left} pre-order places left.` };
        return { ok: true, mode: "preorder", maxQty: left };
      }
      return { ok: true, mode: "preorder", maxQty: null };
    }
    case "out_of_stock":
      if (s.allowBackorder) return { ok: true, mode: "backorder", maxQty: null };
      return { ok: false, reason: "Out of stock." };
    case "available": {
      if (!s.trackInventory) return { ok: true, mode: "stock", maxQty: null };
      const q = sellableQty(s);
      if (qty <= q) return { ok: true, mode: "stock", maxQty: q };
      if (s.allowBackorder) return { ok: true, mode: "backorder", maxQty: null };
      return { ok: false, reason: q === 0 ? "Out of stock." : `Only ${q} available.` };
    }
  }
}

/**
 * Effective availability shown to shoppers: an 'available' tracked item with nothing sellable
 * is displayed as out of stock even if an admin forgot to flip the status — never imply purchasability.
 */
export function effectiveAvailability(s: Sellable): Availability {
  if (s.availability === "available" && s.trackInventory && sellableQty(s) === 0 && !s.allowBackorder) return "out_of_stock";
  return s.availability;
}

export interface PromoWindow { label: PromoLabel; startsAt?: string; endsAt?: string }

/** Active labels honour schedules; expired ones drop off automatically. */
export function activePromoLabels(windows: PromoWindow[], s: Sellable, opts: { showLimitedBelow?: number; hasValidSale?: boolean }, now = new Date()): PromoLabel[] {
  const out = new Set<PromoLabel>();
  for (const w of windows) {
    if (w.startsAt && new Date(w.startsAt) > now) continue;
    if (w.endsAt && new Date(w.endsAt) < now) continue;
    out.add(w.label);
  }
  // 'on_sale' requires a real, currently valid sale price; 'limited_stock' requires reliable tracked inventory.
  if (out.has("on_sale") && !opts.hasValidSale) out.delete("on_sale");
  if (out.has("limited_stock")) {
    const threshold = opts.showLimitedBelow;
    if (!s.trackInventory || threshold === undefined || sellableQty(s) > threshold || sellableQty(s) === 0) out.delete("limited_stock");
  }
  // Promotional labels never apply to unpurchasable items except coming_soon previews.
  if (["out_of_stock", "discontinued", "temporarily_unavailable"].includes(effectiveAvailability(s))) { out.delete("featured"); out.delete("best_seller"); out.delete("limited_stock"); out.delete("on_sale"); }
  return [...out];
}

/** Compatible-label rule: 'new_arrival' and 'just_landed' are redundant together; keep the more specific one. */
export function normalizeLabels(labels: PromoLabel[]): PromoLabel[] {
  const set = new Set(labels);
  if (set.has("just_landed")) set.delete("new_arrival");
  return [...set];
}
