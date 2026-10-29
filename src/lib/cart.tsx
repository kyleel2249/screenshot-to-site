import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getProduct } from "./catalog";

export interface CartLine { slug: string; qty: number }

export function cartTotal(lines: CartLine[]) {
  return lines.reduce((sum, l) => sum + (getProduct(l.slug)?.price ?? 0) * l.qty, 0);
}

export function addLine(lines: CartLine[], slug: string, qty = 1): CartLine[] {
  const found = lines.find((l) => l.slug === slug);
  if (found) return lines.map((l) => (l.slug === slug ? { ...l, qty: l.qty + qty } : l));
  return [...lines, { slug, qty }];
}

interface Ctx {
  lines: CartLine[];
  add: (slug: string) => void;
  setQty: (slug: string, qty: number) => void;
  remove: (slug: string) => void;
  count: number;
  total: number;
}
const CartCtx = createContext<Ctx | null>(null);
const KEY = "ddt-cart";

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  useEffect(() => {
    try { setLines(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch { /* ignore */ }
  }, []);
  const update = (next: CartLine[]) => { setLines(next); localStorage.setItem(KEY, JSON.stringify(next)); };
  const value: Ctx = {
    lines,
    add: (slug) => update(addLine(lines, slug)),
    setQty: (slug, qty) => update(qty <= 0 ? lines.filter((l) => l.slug !== slug) : lines.map((l) => (l.slug === slug ? { ...l, qty } : l))),
    remove: (slug) => update(lines.filter((l) => l.slug !== slug)),
    count: lines.reduce((s, l) => s + l.qty, 0),
    total: cartTotal(lines),
  };
  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}

export function useCart() {
  const c = useContext(CartCtx);
  if (!c) throw new Error("useCart outside CartProvider");
  return c;
}
