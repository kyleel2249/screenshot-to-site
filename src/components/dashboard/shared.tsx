import { Link } from "@tanstack/react-router";
import { GitCompareArrows, Heart, Share2, ShoppingCart, Eye } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ProductImage } from "@/components/ProductImage";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCatalog } from "@/lib/catalog-store";
import { useCurrency } from "@/lib/currency";
import { isOnSale, sku, type ModuleId } from "@/lib/dashboard-lib";
import { breadcrumb } from "@/lib/domain/categories";
import { AVAILABILITY_LABEL, PROMO_LABEL } from "@/lib/domain/status";
import { useGuest } from "@/lib/guest";
import { displayPrice, isPurchasable, type StoreProduct } from "@/lib/storefront";

/* ---------------- dashboard-wide navigation context ---------------- */
interface DashCtx { go: (m: ModuleId, extra?: Record<string, string>) => void; quickView: (slug: string) => void; products: StoreProduct[]; bySlug: (slug: string) => StoreProduct | undefined; }
const D = createContext<DashCtx | null>(null);
export const DashProvider = D.Provider;
export function useDash() { const c = useContext(D); if (!c) throw new Error("useDash outside dashboard"); return c; }

/* ---------------- small pieces ---------------- */
export function Price({ p, size = "md" }: { p: StoreProduct; size?: "sm" | "md" | "lg" }) {
  const { mode, rate } = useCurrency(); const price = displayPrice(p, mode, rate);
  if (!price.current.length) return <span className="text-sm font-medium text-muted-foreground">Price on request</span>;
  const big = size === "lg" ? "text-2xl" : size === "sm" ? "text-sm" : "text-base";
  return (
    <div>
      {price.current.map((c, i) => (
        <div key={c.text} className="flex flex-wrap items-baseline gap-x-2">
          <span className={i === 0 ? `font-semibold text-primary ${big}` : "text-sm text-muted-foreground"}>{c.text}</span>
          {price.original[i] && <span className="text-xs text-muted-foreground line-through">{price.original[i]!.text}</span>}
          {c.note && <span className="text-[11px] text-muted-foreground">{c.note}</span>}
        </div>
      ))}
    </div>
  );
}
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="dash-fade rounded-2xl border border-dashed border-border bg-card p-8 text-center">
      <p className="font-display text-lg font-semibold text-primary">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
export function Heading({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="font-display text-2xl font-bold text-primary">{title}</h2>{sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}</div>
      {right}
    </div>
  );
}
export function Skeletons({ n = 8 }: { n?: number }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4" aria-busy="true" aria-label="Loading products">{Array.from({ length: n }, (_, i) => <div key={i} className="dash-skeleton aspect-[3/4] rounded-2xl" />)}</div>;
}
export const Grid = ({ children }: { children: ReactNode }) => <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">{children}</div>;
export const StatusPill = ({ p }: { p: StoreProduct }) => <span className={p.availability === "available" ? "rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-primary" : "badge-preorder"}>{AVAILABILITY_LABEL[p.availability]}</span>;

/** Pages of products fetched from the same catalogue the storefront uses. */
export function useProducts() {
  const { products, categories, status, reload } = useCatalog();
  const bySlug = useMemo(() => new Map(products.map((p) => [p.slug, p])), [products]);
  return { products, categories, status, reload, bySlug: (s: string) => bySlug.get(s) };
}
export const pick = (slugs: string[], bySlug: (s: string) => StoreProduct | undefined) => slugs.map(bySlug).filter((p): p is StoreProduct => !!p);

/* ---------------- product card (3D hover, animated actions) ---------------- */
export function DashProductCard({ p }: { p: StoreProduct }) {
  const g = useGuest(); const { quickView } = useDash();
  const saved = g.wishlisted(p.slug), cmp = g.inCompare(p.slug), buy = isPurchasable(p);
  const [bump, setBump] = useState(false);
  return (
    <article className="product-card-3d group flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
      <div className="product-card-3d-stage relative aspect-square w-full overflow-hidden">
        <span className="product-card-3d-plate" aria-hidden="true" />
        <button type="button" onClick={() => quickView(p.slug)} aria-label={`Quick view: ${p.name}`} className="absolute inset-0 z-[2] cursor-zoom-in focus-visible:outline-offset-[-3px]" />
        <ProductImage src={p.image} alt={p.imageAlt || p.name} loading="lazy" decoding="async" className="product-card-3d-img relative z-[1] mx-auto block h-full w-full object-contain p-3 sm:p-4" />
        <span className="pointer-events-none absolute left-2 top-2 z-[3] flex flex-wrap gap-1.5">
          {p.availability !== "available" && <span className="badge-preorder">{AVAILABILITY_LABEL[p.availability]}</span>}
          {isOnSale(p) && <span className="badge-label">On sale</span>}
          {p.labels.filter((l) => l !== "on_sale").map((l) => <span key={l} className="badge-label">{PROMO_LABEL[l]}</span>)}
        </span>
        <button type="button" aria-pressed={saved} aria-label={saved ? `Remove ${p.name} from wishlist` : `Save ${p.name} to wishlist`} onClick={() => void g.toggleWishlist(p.slug, p.name)}
          className={`absolute right-2 top-2 z-[4] grid h-9 w-9 place-items-center rounded-full bg-background/90 shadow transition-transform hover:scale-110 ${saved ? "text-gold-dark" : "text-primary"}`}>
          <Heart className={`h-4 w-4 ${saved ? "dash-pop fill-gold stroke-gold-dark" : ""}`} aria-hidden="true" />
        </button>
      </div>
      <div className="flex flex-1 flex-col p-3 sm:p-4">
        <button type="button" onClick={() => quickView(p.slug)} className="line-clamp-2 text-left text-sm font-medium text-foreground hover:underline sm:text-base">{p.name}</button>
        <p className="mt-0.5 text-[11px] text-muted-foreground">SKU {sku(p)}</p>
        {p.rating && p.rating.count > 0 && <p className="mt-0.5 text-xs text-muted-foreground">★ {p.rating.average} ({p.rating.count})</p>}
        <div className="mt-1"><Price p={p} /></div>
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={!buy} onClick={() => { if (g.addToCart(p.variantId, p.name)) { setBump(true); setTimeout(() => setBump(false), 450); } }}
            className={`btn-secondary flex-1 gap-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm ${bump ? "dash-pop" : ""}`}>
            <ShoppingCart className="h-4 w-4" aria-hidden="true" />{buy ? (p.availability === "pre_order" ? "Pre-order" : "Add to cart") : AVAILABILITY_LABEL[p.availability]}
          </button>
          <button type="button" aria-pressed={cmp} aria-label={cmp ? `Remove ${p.name} from comparison` : `Compare ${p.name}`} onClick={() => void g.toggleCompare(p.slug, p.name)}
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border ${cmp ? "border-gold bg-gold/20 text-primary" : "border-border text-primary hover:bg-secondary"}`}><GitCompareArrows className="h-4 w-4" aria-hidden="true" /></button>
          <button type="button" aria-label={`Quick view ${p.name}`} onClick={() => quickView(p.slug)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border text-primary hover:bg-secondary"><Eye className="h-4 w-4" aria-hidden="true" /></button>
        </div>
      </div>
    </article>
  );
}

/* ---------------- quick view ---------------- */
export function QuickView({ slug, onClose, onSwitch }: { slug: string | null; onClose: () => void; onSwitch: (slug: string) => void }) {
  const g = useGuest(); const { bySlug, categories, products } = useProducts(); const { go } = useDash();
  const p = slug ? bySlug(slug) : undefined;
  const [related, setRelated] = useState<string[]>([]);
  useEffect(() => { if (!slug || !p) return; g.markViewed(slug); void g.refreshRecs(slug).then((s) => setRelated([...new Set(s.flatMap((x) => x.slugs))].slice(0, 4))); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [slug]);
  const share = async () => {
    const url = `${window.location.origin}/product/${slug}`;
    try { if (navigator.share) { await navigator.share({ title: p?.name ?? "Product", url }); return; } await navigator.clipboard.writeText(url); toast("Link copied"); } catch { /* cancelled */ }
  };
  const trail = p ? breadcrumb(categories, p.categoryId) : [];
  const specs = p ? Object.entries(p.attributes).filter(([, v]) => v) : [];
  return (
    <Dialog open={!!slug} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-3xl overflow-y-auto p-0">
        {p ? (
          <div className="grid gap-0 md:grid-cols-2">
            <div className="product-card-3d-stage relative aspect-square">
              <span className="product-card-3d-plate" aria-hidden="true" />
              <ProductImage src={p.image} alt={p.imageAlt || p.name} className="product-card-3d-img h-full w-full object-contain p-6" />
            </div>
            <div className="flex flex-col gap-3 p-5">
              <DialogHeader className="text-left">
                <DialogTitle className="font-display text-xl text-primary">{p.name}</DialogTitle>
                <DialogDescription className="text-xs">SKU {sku(p)}{trail.length ? ` · ${trail.map((c) => c.name).join(" › ")}` : ""}</DialogDescription>
              </DialogHeader>
              <div className="flex flex-wrap items-center gap-2"><StatusPill p={p} />{p.labels.map((l) => <span key={l} className="badge-label">{PROMO_LABEL[l]}</span>)}{p.remaining !== undefined && <span className="text-xs font-medium text-primary">Only {p.remaining} left</span>}</div>
              <Price p={p} size="lg" />
              <p className="text-sm text-foreground/80">{p.shortDescription}</p>
              {specs.length > 0 && <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-secondary p-3 text-xs">{specs.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k.replace(/[_-]+/g, " ")}</dt><dd className="font-medium">{v}</dd></div>)}</dl>}
              {p.availability === "pre_order" && <p className="text-xs text-muted-foreground">Pre-order{p.expectedWindow ? `: expected ${p.expectedWindow}` : ""}. You'll be asked to acknowledge the pre-order terms at checkout.</p>}
              <div className="mt-auto flex flex-wrap gap-2 pt-2">
                <button className="btn-secondary flex-1" disabled={!isPurchasable(p)} onClick={() => g.addToCart(p.variantId, p.name)}><ShoppingCart className="mr-1.5 h-4 w-4" aria-hidden="true" />Add to cart</button>
                <button className="btn-primary flex-1" disabled={!isPurchasable(p)} onClick={() => { if (g.addToCart(p.variantId, p.name)) { onClose(); go("cart"); } }}>Buy now</button>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <button type="button" aria-pressed={g.wishlisted(p.slug)} onClick={() => void g.toggleWishlist(p.slug, p.name)} className="rounded-full border border-border px-3 py-1.5 hover:bg-secondary">{g.wishlisted(p.slug) ? "♥ Saved" : "♡ Save"}</button>
                <button type="button" aria-pressed={g.inCompare(p.slug)} onClick={() => void g.toggleCompare(p.slug, p.name)} className="rounded-full border border-border px-3 py-1.5 hover:bg-secondary">{g.inCompare(p.slug) ? "✓ Comparing" : "Compare"}</button>
                <button type="button" onClick={() => void share()} className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 hover:bg-secondary"><Share2 className="h-3.5 w-3.5" aria-hidden="true" />Share</button>
                <Link to="/product/$slug" params={{ slug: p.slug }} className="ml-auto self-center text-primary underline">Full details, gallery &amp; reviews</Link>
              </div>
            </div>
            {related.length > 0 && (
              <div className="border-t border-border p-5 md:col-span-2">
                <p className="mb-2 text-sm font-semibold text-primary">Similar products</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{pick(related, (s) => products.find((x) => x.slug === s)).map((r) => (
                  <button key={r.slug} type="button" onClick={() => onSwitch(r.slug)} className="rounded-xl border border-border p-2 text-left hover:border-gold">
                    <ProductImage src={r.image} alt={r.imageAlt || r.name} className="aspect-square w-full object-contain" /><span className="mt-1 line-clamp-2 block text-xs">{r.name}</span>
                  </button>))}</div>
              </div>
            )}
          </div>
        ) : <div className="p-8 text-center text-sm text-muted-foreground">This product is no longer available.</div>}
      </DialogContent>
    </Dialog>
  );
}
