import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { About, Contact, Delivery, Faq, Notifications, Preferences, Support } from "@/components/dashboard/help";
import { BestSellers, Categories, Featured, NewArrivals, Offers, ShopAll } from "@/components/dashboard/catalogue";
import { Addresses, Orders, Returns, Track } from "@/components/dashboard/orders";
import { DashShell } from "@/components/dashboard/shell";
import { CartModule, Compare, Home, Viewed, Wishlist } from "@/components/dashboard/shopping";
import { DashProvider, QuickView, useProducts } from "@/components/dashboard/shared";
import { isModule, MODULES, type ModuleId } from "@/lib/dashboard-lib";
import { GuestProvider, useGuest } from "@/lib/guest";

/** Search params the dashboard understands. `m` is the module; the rest are short-lived presets passed between modules. */
const KEYS = ["m", "q", "ref", "kind", "order", "cat"] as const;
type Search = Partial<Record<(typeof KEYS)[number], string>>;

export const Route = createFileRoute("/dashboard")({
  validateSearch: (raw: Record<string, unknown>): Search => {
    const out: Search = {};
    for (const k of KEYS) { const v = raw[k]; if (typeof v === "string" && v.length <= 80) out[k] = v; }
    if (out.m && !isModule(out.m)) delete out.m;
    return out;
  },
  head: () => ({ meta: [
    { title: "My Dashboard — Dera Darko Trade" },
    { name: "description", content: "Shop, save, compare and track your orders — no account needed." },
    { name: "robots", content: "noindex,nofollow" },
  ] }),
  component: DashboardPage,
});

function DashboardPage() {
  return <GuestProvider><Dashboard /></GuestProvider>;
}

function Dashboard() {
  const search = Route.useSearch(), navigate = useNavigate(), g = useGuest(), { products, bySlug } = useProducts();
  const active: ModuleId = search.m && isModule(search.m) ? search.m : "home";
  const [quick, setQuick] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const go = useCallback((m: ModuleId, extra?: Record<string, string>) => {
    void navigate({ to: "/dashboard", search: { ...(m === "home" ? {} : { m }), ...(extra ?? {}) } as never });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [navigate]);
  const quickView = useCallback((slug: string) => { setQuick(slug); g.markViewed(slug); }, [g]);
  const ctx = useMemo(() => ({ go, quickView, products, bySlug }), [go, quickView, products, bySlug]);

  useEffect(() => { document.title = `${MODULES.find((m) => m.id === active)?.label ?? "Dashboard"} — Dera Darko Trade`; }, [active]);
  // `key` resets a module's local state whenever the preset changes (e.g. a new search or order reference).
  const body = (() => {
    switch (active) {
      case "home": return <Home />;
      case "shop": return <ShopAll key={search.q ?? ""} q={search.q ?? ""} />;
      case "categories": return <Categories key={search.cat ?? ""} initial={search.cat ?? ""} />;
      case "new": return <NewArrivals />;
      case "best": return <BestSellers />;
      case "featured": return <Featured />;
      case "offers": return <Offers />;
      case "wishlist": return <Wishlist />;
      case "cart": return <CartModule />;
      case "compare": return <Compare />;
      case "viewed": return <Viewed />;
      case "orders": return <Orders />;
      case "track": return <Track key={search.ref ?? ""} {...(search.ref ? { initialRef: search.ref } : {})} />;
      case "returns": return <Returns key={`${search.kind ?? ""}${search.order ?? ""}`} {...(search.kind ? { presetKind: search.kind } : {})} {...(search.order ? { presetOrder: search.order } : {})} />;
      case "addresses": return <Addresses />;
      case "notifications": return <Notifications />;
      case "support": return <Support {...(search.order ? { presetOrder: search.order } : {})} />;
      case "faq": return <Faq />;
      case "delivery": return <Delivery />;
      case "about": return <About />;
      case "contact": return <Contact />;
      case "preferences": return <Preferences />;
    }
  })();

  if (g.status === "error") return (
    <div className="container-x max-w-xl py-20 text-center">
      <h1 className="font-display text-2xl font-bold text-primary">We couldn't start your session</h1>
      <p className="mt-2 text-sm text-muted-foreground">Your browser may be blocking cookies for this site. Allow cookies for this site (they only hold a random session id) and try again.</p>
      <button className="btn-primary mt-5" onClick={() => void g.reload()}>Try again</button>
    </div>
  );
  return (
    <DashProvider value={ctx}>
      <DashShell active={active} panelOpen={panelOpen} onPanel={setPanelOpen}>{body}</DashShell>
      <QuickView slug={quick} onClose={() => setQuick(null)} onSwitch={(s) => { setQuick(s); g.markViewed(s); }} />
    </DashProvider>
  );
}
