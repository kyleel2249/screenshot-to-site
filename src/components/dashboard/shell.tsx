/** Dashboard frame: left sidebar (22 modules), top bar, collapsible right panel, mobile drawer + bottom bar + expandable panels. */
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronsRight, Heart, Home, Menu, Package, PanelRightOpen, Search, ShoppingCart, Store } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { ProductImage } from "@/components/ProductImage";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useCart } from "@/lib/cart";
import { useCurrency } from "@/lib/currency";
import { BOTTOM_NAV, MODULES, type ModuleId } from "@/lib/dashboard-lib";
import type { DisplayMode } from "@/lib/domain/money";
import { useGuest } from "@/lib/guest";
import { useSite } from "@/lib/site";
import { Price, pick, useDash, useProducts } from "./shared";

const GROUPS = ["Shop", "My shopping", "Orders & returns", "Help & settings"] as const;

function Nav({ active, onPick, badge }: { active: ModuleId; onPick: (m: ModuleId) => void; badge: Partial<Record<ModuleId, number>> }) {
  return (
    <nav aria-label="Dashboard sections" className="space-y-5">
      {GROUPS.map((grp) => (
        <div key={grp}>
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-white/50">{grp}</p>
          <ul>
            {MODULES.filter((m) => m.group === grp).map((m) => {
              const on = m.id === active, n = badge[m.id];
              return (
                <li key={m.id}>
                  <button type="button" onClick={() => onPick(m.id)} aria-current={on ? "page" : undefined}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${on ? "bg-gold font-semibold text-gold-foreground" : "text-white/85 hover:bg-white/10"}`}>
                    <span className="truncate">{m.label}</span>
                    {!!n && <span className={`min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold ${on ? "bg-primary text-primary-foreground" : "bg-gold text-gold-foreground"}`} aria-label={`${n} items`}>{n}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Right-hand panel: cart, wishlist, recently viewed, recommendations, promotions, delivery and a support shortcut. All from real session data. */
function Panel() {
  const g = useGuest(), cart = useCart(), site = useSite(), { go, quickView } = useDash(), { bySlug, products } = useProducts();
  const sec = (title: string, items: string[], more: ModuleId, empty: string) => {
    const ps = pick(items, bySlug).slice(0, 3);
    return (
      <section aria-label={title} className="rounded-xl border border-border bg-card p-3">
        <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold text-primary">{title}</h3><button className="text-xs text-primary hover:underline" onClick={() => go(more)}>View all</button></div>
        {ps.length === 0 ? <p className="text-xs text-muted-foreground">{empty}</p> : (
          <ul className="space-y-2">
            {ps.map((p) => (
              <li key={p.slug}><button type="button" onClick={() => quickView(p.slug)} className="flex w-full items-center gap-2 rounded-lg p-1 text-left hover:bg-secondary">
                <ProductImage src={p.image} alt="" className="h-10 w-10 shrink-0 rounded-md bg-secondary object-contain" loading="lazy" />
                <span className="min-w-0 flex-1"><span className="line-clamp-1 text-xs font-medium">{p.name}</span><Price p={p} size="sm" /></span>
              </button></li>
            ))}
          </ul>
        )}
      </section>
    );
  };
  const cartProducts = cart.lines.flatMap((l) => { const p = products.find((x) => x.variantId === l.variantId); return p ? [{ l, p }] : []; });
  const promoSlugs = [...new Set(g.promos.map((p) => p.slug))];
  const rec = g.recs.find((r) => r.id === "for_you") ?? g.recs.find((r) => r.id === "trending") ?? g.recs.find((r) => r.id === "popular");
  return (
    <div className="space-y-3">
      <section aria-label="Cart" className="rounded-xl border border-border bg-card p-3">
        <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold text-primary">Cart ({cart.count})</h3><button className="text-xs text-primary hover:underline" onClick={() => go("cart")}>Open cart</button></div>
        {cartProducts.length === 0 ? <p className="text-xs text-muted-foreground">Your cart is empty.</p> : (
          <ul className="space-y-1.5">{cartProducts.slice(0, 4).map(({ l, p }) => <li key={l.variantId} className="flex items-center justify-between gap-2 text-xs"><span className="line-clamp-1">{p.name}</span><span className="shrink-0 text-muted-foreground">×{l.qty}</span></li>)}</ul>
        )}
        {cart.count > 0 && <button className="btn-primary mt-3 w-full !py-2 text-sm" onClick={() => go("cart")}>Checkout</button>}
      </section>
      {sec("My wishlist", g.state.wishlist, "wishlist", "Save items with the heart icon.")}
      {sec("Recently viewed", g.state.viewed, "viewed", "Products you open will appear here.")}
      {sec(rec ? rec.title : "Recommended", rec?.slugs ?? [], "home", "Recommendations appear after you browse a few products.")}
      {sec("Special offers", promoSlugs, "offers", "No active offers right now.")}
      <section aria-label="Delivery" className="rounded-xl border border-border bg-card p-3 text-xs">
        <h3 className="mb-1 text-sm font-semibold text-primary">Delivery</h3>
        <p className="text-muted-foreground">Fees and lead times depend on your region.</p>
        <button className="mt-1 text-primary hover:underline" onClick={() => go("delivery")}>See delivery information</button>
      </section>
      <section aria-label="Support" className="rounded-xl bg-primary p-3 text-xs text-primary-foreground">
        <h3 className="mb-1 text-sm font-semibold !text-white">Need help?</h3>
        <p className="text-white/80">{site.phone ? `Call ${site.phone} or ` : ""}send us an enquiry.</p>
        <button className="mt-2 rounded-full bg-gold px-3 py-1.5 font-semibold text-gold-foreground" onClick={() => go("support")}>Customer Support</button>
      </section>
    </div>
  );
}

const MODES: DisplayMode[] = ["DUAL", "GHS", "USD"];
const MODE_LABEL: Record<DisplayMode, string> = { DUAL: "GHS + USD", GHS: "GHS", USD: "USD" };

export function DashShell({ active, children, panelOpen, onPanel }: { active: ModuleId; children: ReactNode; panelOpen: boolean; onPanel: (v: boolean) => void }) {
  const g = useGuest(), cart = useCart(), { go } = useDash(), { mode, setMode } = useCurrency();
  const [drawer, setDrawer] = useState(false), [q, setQ] = useState(""), [mobilePanel, setMobilePanel] = useState(false);
  const badge: Partial<Record<ModuleId, number>> = { cart: cart.count, wishlist: g.state.wishlist.length, compare: g.state.compare.length, notifications: g.state.unreadNotifications, orders: g.state.orders.length };
  const pick1 = (m: ModuleId) => { setDrawer(false); go(m); };
  const search = (e: FormEvent) => { e.preventDefault(); const t = q.trim(); if (t) { g.recordSearch(t); go("shop", { q: t }); } };
  const label = MODULES.find((m) => m.id === active)?.label ?? "Dashboard";
  return (
    <div className="mx-auto flex w-full max-w-[1600px] gap-0 lg:gap-6 lg:px-4">
      {/* sidebar (desktop) */}
      <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-64 shrink-0 overflow-y-auto rounded-2xl p-3 lg:my-4 lg:block" style={{ background: "var(--gradient-navy)" }} aria-label="Dashboard menu">
        <Nav active={active} onPick={go} badge={badge} />
      </aside>

      <div className="min-w-0 flex-1">
        {/* top bar */}
        <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-2 backdrop-blur lg:static lg:mt-4 lg:rounded-2xl lg:border lg:bg-card">
          <button type="button" className="grid h-10 w-10 place-items-center rounded-lg border border-border text-primary lg:hidden" aria-label="Open dashboard menu" onClick={() => setDrawer(true)}><Menu className="h-5 w-5" aria-hidden /></button>
          <form onSubmit={search} role="search" className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" placeholder="Search products, brands, categories" maxLength={80}
              className="h-10 w-full rounded-full border border-border bg-background pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </form>
          <label className="sr-only" htmlFor="dash-cur">Display currency</label>
          <select id="dash-cur" value={mode} onChange={(e) => { const m = e.target.value as DisplayMode; setMode(m); if (m !== g.state.prefs.currency) void g.savePrefs({ currency: m }); }}
            className="h-10 rounded-lg border border-border bg-background px-2 text-xs sm:text-sm">{MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}</select>
          <button type="button" className="relative hidden h-10 w-10 place-items-center rounded-lg border border-border text-primary sm:grid" aria-label={`Cart, ${cart.count} items`} onClick={() => go("cart")}>
            <ShoppingCart className="h-5 w-5" aria-hidden />{cart.count > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-gold px-1.5 text-[10px] font-bold text-gold-foreground">{cart.count}</span>}
          </button>
          <button type="button" className="hidden h-10 w-10 place-items-center rounded-lg border border-border text-primary xl:grid" aria-pressed={panelOpen} aria-label={panelOpen ? "Hide side panel" : "Show side panel"} onClick={() => onPanel(!panelOpen)}>{panelOpen ? <ChevronsRight className="h-5 w-5" aria-hidden /> : <PanelRightOpen className="h-5 w-5" aria-hidden />}</button>
        </div>

        <div className="flex gap-6 px-3 py-5 pb-24 lg:px-0 lg:pb-10">
          <div id="dash-main" tabIndex={-1} className="min-w-0 flex-1 focus:outline-none" aria-label={label}>{children}</div>
          {panelOpen && <aside className="hidden w-72 shrink-0 xl:block" aria-label="Quick panel"><div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto pr-1"><Panel /></div></aside>}
        </div>

        {/* mobile / tablet: expandable panel */}
        <div className="px-3 pb-28 xl:hidden">
          <button type="button" aria-expanded={mobilePanel} onClick={() => setMobilePanel((v) => !v)} className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-sm font-semibold text-primary">
            Cart, wishlist, offers &amp; help <ChevronDown className={`h-4 w-4 transition-transform ${mobilePanel ? "rotate-180" : ""}`} aria-hidden />
          </button>
          {mobilePanel && <div className="dash-fade mt-3"><Panel /></div>}
        </div>
      </div>

      {/* mobile drawer */}
      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="left" className="w-[85vw] max-w-sm overflow-y-auto border-0 p-3 text-white" style={{ background: "var(--gradient-navy)" }}>
          <SheetHeader className="mb-3 text-left"><SheetTitle className="font-display !text-white">Your dashboard</SheetTitle><SheetDescription className="text-white/60">No account needed.</SheetDescription></SheetHeader>
          <Nav active={active} onPick={pick1} badge={badge} />
          <Link to="/" className="mt-5 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/85 hover:bg-white/10"><Store className="h-4 w-4" aria-hidden />Back to the main website</Link>
        </SheetContent>
      </Sheet>

      {/* mobile bottom bar */}
      <nav aria-label="Quick navigation" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {BOTTOM_NAV.map((id) => {
          const Icon = id === "home" ? Home : id === "shop" ? Store : id === "cart" ? ShoppingCart : Package, on = active === id, n = badge[id];
          return (
            <button key={id} type="button" aria-current={on ? "page" : undefined} onClick={() => go(id)} className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] ${on ? "font-semibold text-primary" : "text-muted-foreground"}`}>
              <Icon className="h-5 w-5" aria-hidden />{id === "home" ? "Home" : id === "shop" ? "Shop" : id === "cart" ? "Cart" : "Orders"}
              {!!n && <span className="absolute right-1/4 top-1 rounded-full bg-gold px-1.5 text-[10px] font-bold text-gold-foreground">{n}</span>}
            </button>
          );
        })}
        <button type="button" aria-current={active === "wishlist" ? "page" : undefined} onClick={() => go("wishlist")} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${active === "wishlist" ? "font-semibold text-primary" : "text-muted-foreground"}`}><Heart className="h-5 w-5" aria-hidden />Saved</button>
      </nav>
    </div>
  );
}
