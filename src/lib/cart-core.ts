
/** A cart line references a VARIANT id and quantity only — prices are never stored client-side. */
export interface CartLine { variantId: string; qty: number }

export function addLine(lines: CartLine[], variantId: string, qty = 1): CartLine[] {
  const found = lines.find((l) => l.variantId === variantId);
  if (found) return lines.map((l) => (l.variantId === variantId ? { ...l, qty: l.qty + qty } : l));
  return [...lines, { variantId, qty }];
}
