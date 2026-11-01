import { Search, SlidersHorizontal, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState, type FormEvent } from "react";
import { inputCls } from "@/components/Form";
import { ProductImage } from "@/components/ProductImage";
import { DashProductCard, Empty, Grid, Heading, Price, Skeletons, useDash, useProducts } from "@/components/dashboard/shared";
import {
  DEFAULT_FILTERS, facetValues, filterProducts, newArrivals, offerView, page, PAGE_SIZE, saleWindowLabel, SORTS, sortProducts, suggestions, topCategories, withLabel,
  type Filters, type SortId,
} from "@/lib/dashboard-lib";
import { childrenOf } from "@/lib/domain/categories";
import { formatMoney } from "@/lib/domain/money";
import { useGuest } from "@/lib/guest";
import type { StoreProduct } from "@/lib/storefront";

/** Search, filters, sorting and "load more" over any base list of REAL products. */
function Browser({ base, title, sub, emptyTitle, emptyNote, defaultSort = "newest", initialCategory = "", initialQuery = "" }: { base: StoreProduct[]; title: string; sub?: string; emptyTitle: string; emptyNote: string; defaultSort?: SortId; initialCategory?: string; initialQuery?: string }) {
  const g = useGuest(); const { go } = useDash(); const { categories, status, reload } = useProducts();
  const [f, setF] = useState<Filters>({ ...DEFAULT_FILTERS, sort: defaultSort, categoryId: initialCategory, q: initialQuery });
  const [pages, setPages] = useState(1); const [open, setOpen] = useState(false); const [focus, setFocus] = useState(false);
  const deferred = useDeferredValue(f);
  useEffect(() => { setPages(1); }, [f]);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }));
  const popular = g.recs.find((r) => r.id === "popular")?.slugs ?? [];
  const results = useMemo(() => sortProducts(filterProducts(base, deferred, categories), deferred.sort, deferred.currency, { popular }), [base, deferred, categories, popular.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  const { brands, models } = useMemo(() => facetValues(base), [base]);
  const sugg = useMemo(() => (focus ? suggestions(f.q, base, categories) : []), [focus, f.q, base, categories]);
  const subs = f.categoryId ? childrenOf(categories, f.categoryId) : [];
  const hasRatings = base.some((p) => p.rating && p.rating.count > 0);
  const active = [f.categoryId, f.min, f.max, f.brand, f.model, f.availability, f.onlyPromo && "p", f.onlyNew && "n", f.minRating && "r"].filter(Boolean).length;
  const submit = (e: FormEvent) => { e.preventDefault(); g.recordSearch(f.q); setFocus(false); };

  if (status === "loading") return <><Heading title={title} /><Skeletons /></>;
  if (status === "error") return <Empty title="We couldn't load the catalogue" action={<button className="btn-primary" onClick={() => void reload()}>Try again</button>}>Check your connection and try again.</Empty>;
  return (
    <section aria-label={title}>
      <Heading title={title} sub={sub ?? `${results.length} of ${base.length} product${base.length === 1 ? "" : "s"}`} />
      <form role="search" onSubmit={submit} className="relative mb-3 flex gap-2">
        <div className="relative flex-1">
          <label htmlFor="dash-search" className="sr-only">Search products by name, SKU, category, brand, model or description</label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input id="dash-search" className={`${inputCls} pl-9`} placeholder="Search name, SKU, brand, model, category…" value={f.q} autoComplete="off" onChange={(e) => set("q", e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)} />
          {focus && (sugg.length > 0 || (!f.q && g.state.searches.length > 0)) && (
            <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover shadow-lg" role="listbox" aria-label="Search suggestions">
              {!f.q && <li className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Recent searches</li>}
              {!f.q && g.state.searches.slice(0, 5).map((s) => <li key={s}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-secondary" onMouseDown={(e) => e.preventDefault()} onClick={() => { set("q", s); setFocus(false); }}>{s}</button></li>)}
              {sugg.map((s) => <li key={`${s.kind}${s.text}`}><button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-secondary" onMouseDown={(e) => e.preventDefault()} onClick={() => { if (s.kind === "category" && s.id) { set("categoryId", s.id); set("q", ""); } else set("q", s.text); setFocus(false); }}>{s.text}<span className="text-[11px] text-muted-foreground">{s.kind}</span></button></li>)}
            </ul>
          )}
        </div>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="dash-filters" className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 text-sm font-medium text-primary hover:bg-secondary"><SlidersHorizontal className="h-4 w-4" aria-hidden="true" />Filters{active > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-gold px-1 text-[10px] font-bold text-gold-foreground">{active}</span>}</button>
      </form>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label htmlFor="dash-sort" className="text-sm text-muted-foreground">Sort</label>
        <select id="dash-sort" className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" value={f.sort} onChange={(e) => set("sort", e.target.value as SortId)}>
          {SORTS.map((s) => <option key={s.id} value={s.id} disabled={(s.id === "popular" || s.id === "best") && popular.length === 0 && !base.some((p) => p.labels.includes("best_seller")) ? true : s.id === "rated" && !hasRatings}>{s.label}{(s.id === "popular" || s.id === "best") && popular.length === 0 && !base.some((p) => p.labels.includes("best_seller")) ? " (needs sales data)" : s.id === "rated" && !hasRatings ? " (no reviews yet)" : ""}</option>)}
        </select>
        {active > 0 && <button type="button" className="inline-flex items-center gap-1 text-sm text-primary underline" onClick={() => setF({ ...DEFAULT_FILTERS, sort: f.sort, q: f.q })}><X className="h-3.5 w-3.5" aria-hidden="true" />Clear filters</button>}
      </div>
      {open && (
        <div id="dash-filters" className="dash-fade mb-4 grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
          <div><label className="mb-1 block text-xs font-medium" htmlFor="f-cat">Category</label>
            <select id="f-cat" className={inputCls} value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)}><option value="">All categories</option>
              {categories.filter((c) => !c.parentId && c.published).map((c) => <optgroup key={c.id} label={c.name}><option value={c.id}>All {c.name}</option>{childrenOf(categories, c.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>)}</select></div>
          <div><label className="mb-1 block text-xs font-medium" htmlFor="f-cur">Price currency</label>
            <select id="f-cur" className={inputCls} value={f.currency} onChange={(e) => set("currency", e.target.value as Filters["currency"])}><option value="GHS">Ghanaian Cedi (GHS)</option><option value="USD">US Dollar (USD)</option></select></div>
          <div className="grid grid-cols-2 gap-2"><div><label className="mb-1 block text-xs font-medium" htmlFor="f-min">Min price</label><input id="f-min" inputMode="decimal" className={inputCls} value={f.min} onChange={(e) => set("min", e.target.value)} placeholder="0" /></div>
            <div><label className="mb-1 block text-xs font-medium" htmlFor="f-max">Max price</label><input id="f-max" inputMode="decimal" className={inputCls} value={f.max} onChange={(e) => set("max", e.target.value)} placeholder="Any" /></div></div>
          <div><label className="mb-1 block text-xs font-medium" htmlFor="f-av">Availability</label>
            <select id="f-av" className={inputCls} value={f.availability} onChange={(e) => set("availability", e.target.value as Filters["availability"])}><option value="">Any status</option><option value="buyable">Can be ordered now</option><option value="available">In stock</option><option value="pre_order">Pre-order</option><option value="coming_soon">Coming soon</option><option value="out_of_stock">Out of stock</option></select></div>
          {brands.length > 0 && <div><label className="mb-1 block text-xs font-medium" htmlFor="f-brand">Brand</label><select id="f-brand" className={inputCls} value={f.brand} onChange={(e) => set("brand", e.target.value)}><option value="">Any brand</option>{brands.map((b) => <option key={b}>{b}</option>)}</select></div>}
          {models.length > 0 && <div><label className="mb-1 block text-xs font-medium" htmlFor="f-model">Model</label><select id="f-model" className={inputCls} value={f.model} onChange={(e) => set("model", e.target.value)}><option value="">Any model</option>{models.map((b) => <option key={b}>{b}</option>)}</select></div>}
          {hasRatings && <div><label className="mb-1 block text-xs font-medium" htmlFor="f-rate">Rating</label><select id="f-rate" className={inputCls} value={f.minRating} onChange={(e) => set("minRating", Number(e.target.value))}><option value={0}>Any</option><option value={4}>4★ and up</option><option value={3}>3★ and up</option></select></div>}
          <div className="flex flex-wrap items-end gap-4 text-sm"><label className="inline-flex items-center gap-2"><input type="checkbox" checked={f.onlyPromo} onChange={(e) => set("onlyPromo", e.target.checked)} />On promotion</label><label className="inline-flex items-center gap-2"><input type="checkbox" checked={f.onlyNew} onChange={(e) => set("onlyNew", e.target.checked)} />New arrivals</label></div>
        </div>
      )}
      {subs.length > 0 && <div className="mb-3 flex flex-wrap gap-2" aria-label="Subcategories">{subs.map((s) => <button key={s.id} type="button" onClick={() => set("categoryId", s.id)} className="rounded-full border border-border px-3 py-1 text-xs hover:border-gold hover:bg-gold/10">{s.name}</button>)}</div>}
      {results.length === 0
        ? <Empty title={base.length === 0 ? emptyTitle : "No products match"} action={base.length === 0 ? <button className="btn-secondary" onClick={() => go("shop")}>Browse all products</button> : <button className="btn-secondary" onClick={() => setF({ ...DEFAULT_FILTERS, sort: defaultSort })}>Clear search and filters</button>}>{base.length === 0 ? emptyNote : "Try fewer words, a wider price range, or clear the filters."}</Empty>
        : <><Grid>{page(results, pages).map((p) => <DashProductCard key={p.slug} p={p} />)}</Grid>
          {results.length > pages * PAGE_SIZE && <div className="mt-5 text-center"><button className="btn-secondary" onClick={() => setPages((n) => n + 1)}>Load more ({results.length - pages * PAGE_SIZE} remaining)</button></div>}</>}
    </section>
  );
}

export function ShopAll({ q = "" }: { q?: string }) { const { products } = useProducts(); return <Browser initialQuery={q} base={products} title="Shop All Products" emptyTitle="The catalogue is being prepared" emptyNote="Products appear here as soon as the business publishes them with an approved price." />; }
export function NewArrivals() {
  const { products } = useProducts(); const n = useMemo(() => newArrivals(products, 60), [products]);
  return <Browser base={n.items} title="New Arrivals" sub={n.labelled ? undefined : "Nothing is labelled “new” yet, so these are the most recently added products."} emptyTitle="No products yet" emptyNote="New products will appear here as they are added." />;
}
export function BestSellers() {
  const { products } = useProducts(); const g = useGuest(); const { bySlug } = useProducts();
  const labelled = useMemo(() => withLabel(products, "best_seller"), [products]);
  const fromSales = (g.recs.find((r) => r.id === "popular")?.slugs ?? []).map(bySlug).filter((p): p is StoreProduct => !!p);
  const base = useMemo(() => [...new Map([...labelled, ...fromSales].map((p) => [p.slug, p])).values()], [labelled, fromSales.map((p) => p.slug).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Browser base={base} title="Best Sellers" defaultSort="best" emptyTitle="No best sellers yet" emptyNote="Best sellers are shown from real orders and the owner's own labels. None exist yet, so we won't invent any." />;
}
export function Featured() { const { products } = useProducts(); const base = useMemo(() => withLabel(products, "featured"), [products]); return <Browser base={base} title="Featured Products" defaultSort="featured" emptyTitle="Nothing is featured right now" emptyNote="The business hasn't featured any products yet." />; }

export function Categories({ initial = "" }: { initial?: string }) {
  const { products, categories, status } = useProducts(); const [cat, setCat] = useState(initial);
  const tops = useMemo(() => topCategories(products, categories), [products, categories]);
  if (cat) return <><button className="mb-3 text-sm text-primary underline" onClick={() => setCat("")}>← All categories</button><Browser key={cat} base={products} initialCategory={cat} title={categories.find((c) => c.id === cat)?.name ?? "Category"} emptyTitle="No products" emptyNote="" /></>;
  return (
    <section aria-label="Categories"><Heading title="Categories" sub="Every category from the store, with the number of products currently listed." />
      {status === "loading" ? <Skeletons n={8} /> : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{tops.map(({ node, count }) => (
          <li key={node.id} className="dash-fade rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)] transition-transform hover:-translate-y-1 motion-reduce:transition-none">
            <button type="button" onClick={() => setCat(node.id)} className="flex w-full items-baseline justify-between gap-2 text-left"><span className="font-display text-lg font-semibold text-primary">{node.name}</span><span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{count} item{count === 1 ? "" : "s"}</span></button>
            <div className="mt-2 flex flex-wrap gap-1.5">{childrenOf(categories, node.id).map((s) => <button key={s.id} type="button" onClick={() => setCat(s.id)} className="rounded-full border border-border px-2.5 py-0.5 text-[11px] hover:border-gold hover:bg-gold/10">{s.name}</button>)}</div>
          </li>))}</ul>)}
    </section>
  );
}

export function Offers() {
  const g = useGuest(); const { products } = useProducts(); const { quickView, go } = useDash();
  useEffect(() => { void g.refreshPromos(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const rows = g.promos.map((s) => offerView(s, products)).filter((x): x is NonNullable<typeof x> => !!x);
  return (
    <section aria-label="Special offers"><Heading title="Special Offers" sub="Real sale prices set by the business, with their real dates. Nothing here is a made-up discount." />
      {rows.length === 0 ? <Empty title="No offers running right now" action={<button className="btn-secondary" onClick={() => go("shop")}>Shop all products</button>}>When the business puts a product on sale it appears here with the original price, the sale price and when the sale ends.</Empty> : (
        <ul className="grid gap-3 md:grid-cols-2">{rows.map(({ sale, product }) => (
          <li key={`${sale.slug}${sale.currency}`} className="dash-fade flex gap-3 rounded-2xl border border-border bg-card p-3 shadow-[var(--shadow-card)]">
            <button type="button" onClick={() => quickView(product.slug)} className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-secondary"><ProductImage src={product.image} alt={product.imageAlt || product.name} className="h-full w-full object-contain" /></button>
            <div className="min-w-0 flex-1"><p className="line-clamp-2 font-medium">{product.name}</p>
              <p className="mt-1 flex flex-wrap items-baseline gap-2"><span className="font-semibold text-primary">{formatMoney({ amount: sale.sale, currency: sale.currency })}</span><span className="text-xs text-muted-foreground line-through">{formatMoney({ amount: sale.original, currency: sale.currency })}</span><span className="badge-label">{sale.percentOff}% off</span></p>
              <p className="mt-1 text-xs text-muted-foreground">{saleWindowLabel(sale)}</p>
              <div className="mt-2 flex gap-2"><button className="btn-secondary px-4 py-1.5 text-xs" onClick={() => g.addToCart(product.variantId, product.name)}>Add to cart</button><button className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-secondary" onClick={() => quickView(product.slug)}>Quick view</button></div></div>
          </li>))}</ul>)}
      <p className="mt-5 rounded-xl bg-secondary p-3 text-xs text-muted-foreground">Have a promo code? Enter it in your cart — it is checked and applied by the server, and you'll see the exact discount before you pay. Codes are never listed publicly.</p>
    </section>
  );
}
