import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { addLine, type CartLine } from "./cart-core";
import { useCatalog } from "./catalog-store";
import { canAdd, findByVariant } from "./storefront";

export { addLine, type CartLine } from "./cart-core";

export type AddResult = { ok: true } | { ok: false; reason: string };

interface Ctx {
  lines: CartLine[];
  add: (variantId: string) => AddResult;
  setQty: (variantId: string, qty: number) => AddResult;
  remove: (variantId: string) => void;
  clear: () => void;
  count: number;
}
const CartCtx = createContext<Ctx | null>(null);
const KEY = "ddt-cart-v2";

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const { products, status } = useCatalog();
  useEffect(() => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(KEY) || "[]");
      if (Array.isArray(raw)) setLines(raw.filter((l): l is CartLine => !!l && typeof l.variantId === "string" && Number.isInteger(l.qty) && l.qty > 0));
    } catch { /* ignore corrupt storage */ }
  }, []);
  const persist = (next: CartLine[]) => { setLines(next); try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ } };

  const guard = (variantId: string, qty: number): AddResult => {
    if (status === "loading") return { ok: false, reason: "The catalogue is still loading. Try again in a moment." };
    if (status === "error") return { ok: false, reason: "We couldn't load the catalogue. Check your connection and refresh." };
    return canAdd(findByVariant(products, variantId), qty);
  };

  const value: Ctx = {
    lines,
    add: (id) => {
      const next = (lines.find((l) => l.variantId === id)?.qty ?? 0) + 1;
      const g = guard(id, next);
      if (g.ok) persist(addLine(lines, id));
      return g;
    },
    setQty: (id, qty) => {
      if (qty <= 0) { persist(lines.filter((l) => l.variantId !== id)); return { ok: true }; }
      const g = guard(id, qty);
      if (g.ok) persist(lines.map((l) => (l.variantId === id ? { ...l, qty } : l)));
      return g;
    },
    remove: (id) => persist(lines.filter((l) => l.variantId !== id)),
    clear: () => persist([]),
    count: lines.reduce((s, l) => s + l.qty, 0),
  };
  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}

export function useCart() {
  const c = useContext(CartCtx);
  if (!c) throw new Error("useCart outside CartProvider");
  return c;
}
