/**
 * Browser side of the anonymous-session dashboard.
 *
 *  - Opens the session on mount (GET /api/guest/session issues the signed cookie; nothing to log in to).
 *  - Holds the server-side state (wishlist, compare, recently viewed, searches, addresses, preferences, order summaries).
 *  - Mirrors the shopping cart with the storefront's own cart (`useCart`) so the header count, /cart and the dashboard always agree:
 *    the browser cart is the working copy, the server cart is the session's durable copy that restores it on a new device or after
 *    the browser's storage is cleared. Quantities only — prices are never stored or trusted client-side.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useCart } from "@/lib/cart";
import { mergeCarts } from "@/lib/cart-core";
import { useCatalog } from "@/lib/catalog-store";
import { useCurrency } from "@/lib/currency";
import type {
  CartQuote, EnquiryView, GuestNotification, GuestPrefs, GuestState, OrderDetail, RecSection, ReturnRequestView, SaleInfo,
} from "@/lib/guest-types";
import type { Currency } from "@/lib/domain/money";

export interface GuestResult<T = unknown> { ok: boolean; status: number; data: T | null; errors: string[] }
type Data = { state?: GuestState } & Record<string, unknown>;

async function raw<T>(method: string, path: string, body?: unknown): Promise<GuestResult<T>> {
  try {
    const res = await fetch(`/api/guest${path}`, { method, credentials: "same-origin", headers: body !== undefined ? { "Content-Type": "application/json" } : {}, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await res.text(); let data: unknown = null; try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    const d = data as { error?: string; errors?: string[] } | null;
    return { ok: res.ok, status: res.status, data: res.ok ? (data as T) : null, errors: res.ok ? [] : d?.errors ?? (d?.error && d.error !== "no_session" ? [d.error] : ["Something went wrong. Please try again."]) };
  } catch { return { ok: false, status: 0, data: null, errors: ["Network error. Check your connection and try again."] }; }
}

interface Ctx {
  status: "loading" | "ready" | "error";
  state: GuestState;
  recs: RecSection[]; promos: SaleInfo[];
  /** Low-level call; a lost session (401) is re-opened once and the call retried. */
  call: <T = Data>(method: string, path: string, body?: unknown) => Promise<GuestResult<T>>;
  wishlisted: (slug: string) => boolean; inCompare: (slug: string) => boolean;
  toggleWishlist: (slug: string, name?: string) => Promise<void>;
  toggleCompare: (slug: string, name?: string) => Promise<void>;
  addToCart: (variantId: string, name?: string) => boolean;
  setQty: (variantId: string, qty: number) => void;
  markViewed: (slug: string) => void;
  recordSearch: (q: string) => void;
  savePrefs: (patch: Partial<GuestPrefs>) => Promise<GuestResult<Data>>;
  refreshRecs: (slug?: string) => Promise<RecSection[]>;
  refreshPromos: () => Promise<void>;
  quote: (b: { currency: Currency; region?: string; zoneId?: string; discountCode?: string }) => Promise<{ ok: true; quote: CartQuote } | { ok: false; errors: string[] }>;
  orders: () => Promise<OrderDetail[]>; notifications: () => Promise<GuestNotification[]>; enquiries: () => Promise<EnquiryView[]>; returns: () => Promise<ReturnRequestView[]>;
  setState: (s: GuestState) => void; reload: () => Promise<void>;
}
const C = createContext<Ctx | null>(null);
const EMPTY: GuestState = { expiresAt: 0, cart: [], wishlist: [], compare: [], viewed: [], searches: [], addresses: [], prefs: { preferredName: "", email: "", phone: "", currency: "DUAL", region: "", interests: [], notifyOrderUpdates: true, notifyBackInStock: true, notifyPriceAlerts: false, notifyMarketing: false }, orders: [], unreadNotifications: 0 };

export function GuestProvider({ children }: { children: ReactNode }) {
  const cart = useCart(), catalog = useCatalog(), { setMode } = useCurrency();
  const [state, setStateRaw] = useState<GuestState>(EMPTY);
  const [status, setStatus] = useState<Ctx["status"]>("loading");
  const [recs, setRecs] = useState<RecSection[]>([]); const [promos, setPromos] = useState<SaleInfo[]>([]);
  const stateRef = useRef(state); stateRef.current = state;
  const cartRef = useRef(cart); cartRef.current = cart;
  const setState = useCallback((s: GuestState) => { stateRef.current = s; setStateRaw(s); }, []);

  const open = useCallback(async () => {
    const r = await raw<{ state: GuestState }>("GET", "/session");
    if (r.ok && r.data) { setState(r.data.state); setStatus("ready"); return true; }
    setStatus("error"); return false;
  }, [setState]);
  const call = useCallback(async <T = Data,>(method: string, path: string, body?: unknown): Promise<GuestResult<T>> => {
    let r = await raw<T>(method, path, body);
    if (r.status === 401 && (await open())) r = await raw<T>(method, path, body);
    const d = r.data as Data | null; if (r.ok && d?.state) setState(d.state);
    return r;
  }, [open, setState]);

  const refreshRecs = useCallback(async (slug?: string) => { const r = await raw<RecSection[]>("GET", `/recommendations${slug ? `?slug=${encodeURIComponent(slug)}` : ""}`); const v = r.ok && r.data ? r.data : []; if (!slug) setRecs(v); return v; }, []);
  const refreshPromos = useCallback(async () => { const r = await raw<SaleInfo[]>("GET", "/promotions"); if (r.ok && r.data) setPromos(r.data); }, []);
  const reload = useCallback(async () => { setStatus("loading"); await open(); }, [open]);
  useEffect(() => { void open().then((ok) => { if (ok) { void refreshRecs(); void refreshPromos(); } }); }, [open, refreshRecs, refreshPromos]);

  /* ---- cart mirror ---- */
  const reconciled = useRef(false), chain = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (status !== "ready" || catalog.status !== "ready" || reconciled.current) return;
    reconciled.current = true;
    const merged = mergeCarts(cartRef.current.lines, stateRef.current.cart);
    const local = cartRef.current.lines, server = stateRef.current.cart;
    if (merged.some((l) => local.find((x) => x.variantId === l.variantId)?.qty !== l.qty) || local.length !== merged.length) cartRef.current.replace(merged); // restore/merge into the browser cart
    chain.current = chain.current.then(async () => { for (const l of merged) if (server.find((x) => x.variantId === l.variantId)?.qty !== l.qty) await call("POST", "/cart", { variantId: l.variantId, qty: l.qty }); });
  }, [status, catalog.status, call]);
  const lineKey = cart.lines.map((l) => `${l.variantId}:${l.qty}`).join("|");
  useEffect(() => {
    if (!reconciled.current) return;
    const local = cartRef.current.lines;
    chain.current = chain.current.then(async () => {
      const server = stateRef.current.cart, wanted = new Map(local.map((l) => [l.variantId, l.qty]));
      for (const [variantId, qty] of wanted) {
        if (server.find((s) => s.variantId === variantId)?.qty === qty) continue;
        const r = await call("POST", "/cart", { variantId, qty });
        if (!r.ok && r.status !== 0) { // the server refused (sold out, withdrawn…): tell the shopper and drop it from the working cart
          toast.error(r.errors[0] ?? "That item can't be added right now.");
          const back = stateRef.current.cart.find((s) => s.variantId === variantId);
          cartRef.current.replace(cartRef.current.lines.flatMap((l) => (l.variantId !== variantId ? [l] : back ? [{ ...l, qty: back.qty }] : [])));
        }
      }
      for (const s of stateRef.current.cart) if (!wanted.has(s.variantId)) await call("POST", "/cart", { variantId: s.variantId, qty: 0 });
    });
  }, [lineKey, call]);

  const value = useMemo<Ctx>(() => ({
    status, state, recs, promos, call,
    wishlisted: (slug) => state.wishlist.includes(slug), inCompare: (slug) => state.compare.includes(slug),
    toggleWishlist: async (slug, name) => { const on = !stateRef.current.wishlist.includes(slug); const r = await call("POST", "/wishlist", { slug, on }); if (!r.ok) toast.error(r.errors[0] ?? "That didn't save."); else toast(on ? `${name ?? "Item"} saved to your wishlist` : `${name ?? "Item"} removed from your wishlist`); },
    toggleCompare: async (slug, name) => { const on = !stateRef.current.compare.includes(slug); const r = await call("POST", "/compare", { slug, on }); if (!r.ok) toast.error(r.errors[0] ?? "That didn't save."); else toast(on ? `${name ?? "Item"} added to comparison` : `${name ?? "Item"} removed from comparison`); },
    addToCart: (variantId, name) => { const r = cartRef.current.add(variantId); if (r.ok) toast(`${name ?? "Item"} added to your cart`); else toast.error(r.reason); return r.ok; },
    setQty: (variantId, qty) => { const r = cartRef.current.setQty(variantId, qty); if (!r.ok) toast.error(r.reason); },
    markViewed: (slug) => { void call("POST", "/viewed", { slug }); },
    recordSearch: (q) => { if (q.trim().length >= 2) void call("POST", "/searches", { q }); },
    savePrefs: async (patch) => { const r = await call<Data>("PUT", "/preferences", patch); if (r.ok && patch.currency) setMode(patch.currency); return r; },
    refreshRecs, refreshPromos,
    quote: async (b) => { const r = await call<{ ok: true; quote: CartQuote }>("POST", "/cart/quote", b); return r.ok && r.data ? { ok: true as const, quote: (r.data as unknown as { quote: CartQuote }).quote } : { ok: false as const, errors: r.errors }; },
    orders: async () => { const r = await call<OrderDetail[]>("GET", "/orders"); return r.ok && r.data ? r.data : []; },
    notifications: async () => { const r = await call<GuestNotification[]>("GET", "/notifications"); return r.ok && r.data ? r.data : []; },
    enquiries: async () => { const r = await call<EnquiryView[]>("GET", "/enquiries"); return r.ok && r.data ? r.data : []; },
    returns: async () => { const r = await call<ReturnRequestView[]>("GET", "/returns"); return r.ok && r.data ? r.data : []; },
    setState, reload,
  }), [status, state, recs, promos, call, refreshRecs, refreshPromos, setMode, setState, reload]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
export function useGuest() { const c = useContext(C); if (!c) throw new Error("useGuest outside GuestProvider"); return c; }
