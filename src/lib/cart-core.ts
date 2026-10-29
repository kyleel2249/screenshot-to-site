import { getVariantMap } from "./catalog";
import { priceCart, type CartInput, type PriceResult } from "./domain/commerce";
import type { Currency } from "./domain/money";

/** A cart line references a VARIANT id and quantity only — prices are never stored client-side. */
export interface CartLine { variantId: string; qty: number }

export function addLine(lines: CartLine[], variantId: string, qty = 1): CartLine[] {
  const found = lines.find((l) => l.variantId === variantId);
  if (found) return lines.map((l) => (l.variantId === variantId ? { ...l, qty: l.qty + qty } : l));
  return [...lines, { variantId, qty }];
}

/** Authoritative re-pricing from current variant records (stock, status, sale windows, currency). */
export function quote(lines: CartLine[], currency: Currency, discountCode?: string): PriceResult {
  const input: CartInput = { lines, currency, ...(discountCode ? { discountCode } : {}) };
  return priceCart(input, getVariantMap(), {});
}
