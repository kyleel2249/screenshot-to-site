import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import { addLine, mergeCarts, type CartLine } from "./cart-core";
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
  /** Call after sign-in: merges this browser's cart with the saved account cart. */
  afterLogin: () => Promise<void>;
  /** Call after sign-out: empties this browser's cart so the next person on this device doesn't see it. */
  afterLogout: () => void;
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
  const signedIn = useRef(false);
  const saveLocal = (next: CartLine[]) => { try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ } };
  // Signed-in customers' carts are also saved on the server (variant ids + quantities only) so they follow them across devices.
  const saveRemote = (next: CartLine[]) => { if (signedIn.current) void api.saveCart(next); };
  const persist = (next: CartLine[]) => { setLines(next); saveLocal(next); saveRemote(next); };
  const sync = async () => {
    const r = await api.cart();
    if (!r.ok || !r.data) { signedIn.current = false; return; } // guests get 401: the browser cart is all there is
    signedIn.current = true;
    let local: CartLine[] = []; try { const raw: unknown = JSON.parse(localStorage.getItem(KEY) || "[]"); if (Array.isArray(raw)) local = raw.filter((l): l is CartLine => !!l && typeof l.variantId === "string" && Number.isInteger(l.qty) && l.qty > 0); } catch { /* ignore */ }
    const merged = mergeCarts(local, r.data);
    const saved = await api.saveCart(merged); // the server drops anything no longer for sale and returns the cleaned cart
    const final = saved.ok && saved.data ? saved.data : merged;
    setLines(final); saveLocal(final);
  };
  useEffect(() => { void sync(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    afterLogin: sync,
    afterLogout: () => { signedIn.current = false; setLines([]); saveLocal([]); },
  };
  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}

export function useCart() {
  const c = useContext(CartCtx);
  if (!c) throw new Error("useCart outside CartProvider");
  return c;
}
