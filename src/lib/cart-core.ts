
/** A cart line references a VARIANT id and quantity only — prices are never stored client-side. */
export interface CartLine { variantId: string; qty: number }

export function addLine(lines: CartLine[], variantId: string, qty = 1): CartLine[] {
  const found = lines.find((l) => l.variantId === variantId);
  if (found) return lines.map((l) => (l.variantId === variantId ? { ...l, qty: l.qty + qty } : l));
  return [...lines, { variantId, qty }];
}

export const CART_MAX_QTY = 99;
/**
 * Combines the cart held in this browser with the one saved on the account when someone signs in. Each item keeps the LARGER of the two
 * quantities (not the sum), so signing in repeatedly on the same device never doubles anything.
 */
export function mergeCarts(local: CartLine[], saved: CartLine[]): CartLine[] {
  const out = new Map<string, number>();
  for (const l of [...saved, ...local]) out.set(l.variantId, Math.min(CART_MAX_QTY, Math.max(out.get(l.variantId) ?? 0, l.qty)));
  return [...out].map(([variantId, qty]) => ({ variantId, qty }));
}
export const sameCart = (a: CartLine[], b: CartLine[]) => a.length === b.length && a.every((l) => b.find((x) => x.variantId === l.variantId)?.qty === l.qty);
