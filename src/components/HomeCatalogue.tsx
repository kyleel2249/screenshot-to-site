import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useCatalog } from "@/lib/catalog-store";
import { productsIn, search, sortProducts, type StoreProduct } from "@/lib/storefront";
import { childrenOf, topLevel } from "@/lib/domain/categories";
import { ProductCard } from "@/components/ProductCard";

type HomeSort = "newest" | "price-asc" | "price-desc" | "name-asc" | "name-desc";
const PAGE = 24;

/** Database-driven product collection for the homepage (sidebar + grid + load more). */
export function HomeCatalogue() {
  const { products, categories, status, reload } = useCatalog();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [sort, setSort] = useState<HomeSort>("newest");
  const [q, setQ] = useState("");
  const [visible, setVisible] = useState(PAGE);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [filtersOpen, setFiltersOpen] = useState(false);

  const tops = topLevel(categories);

  const filtered = useMemo(() => {
    let list: StoreProduct[] = categoryId ? productsIn(products, categories, categoryId) : products;
    list = search(list, q, categories);
    if (sort === "name-asc") list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "name-desc") list = [...list].sort((a, b) => b.name.localeCompare(a.name));
    else list = sortProducts(list, sort === "price-asc" || sort === "price-desc" || sort === "newest" ? sort : "newest");
    return list;
  }, [products, categories, categoryId, q, sort]);

  const pageItems = filtered.slice(0, visible);
  const hasMore = pageItems.length < filtered.length;
  const selectedName = categoryId
    ? categories.find((c) => c.id === categoryId)?.name ?? "Collection"
    : "All Products";

  const Sidebar = (
    <aside className="space-y-6" aria-label="Catalogue categories">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Categories</p>
        <ul className="mt-3 space-y-0.5 text-sm">
          <li>
            <button
              type="button"
              onClick={() => {
                setCategoryId(null);
                setVisible(PAGE);
              }}
              className={`block w-full rounded-md px-3 py-2 text-left transition-colors ${
                !categoryId ? "bg-primary text-primary-foreground" : "text-foreground/80 hover:bg-gold/15 hover:text-primary"
              }`}
            >
              All Products
              <span className="ml-1 text-xs opacity-80">({products.length})</span>
            </button>
          </li>
          {tops.map((c) => {
            const subs = childrenOf(categories, c.id);
            const count = productsIn(products, categories, c.id).length;
            const active = categoryId === c.id || categories.find((x) => x.id === categoryId)?.parentId === c.id;
            const open = expanded[c.id] ?? active;
            return (
              <li key={c.id}>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setCategoryId(c.id);
                      setVisible(PAGE);
                    }}
                    className={`flex-1 rounded-md px-3 py-2 text-left transition-colors ${
                      active ? "bg-primary/10 font-medium text-primary" : "text-foreground/80 hover:bg-gold/15 hover:text-primary"
                    }`}
                  >
                    {c.name}
                    <span className="ml-1 text-xs text-muted-foreground">({count})</span>
                  </button>
                  {subs.length > 0 && (
                    <button
                      type="button"
                      className="rounded p-1 text-muted-foreground hover:bg-gold/15 hover:text-primary"
                      aria-expanded={open}
                      aria-label={`${open ? "Collapse" : "Expand"} ${c.name}`}
                      onClick={() => setExpanded((e) => ({ ...e, [c.id]: !open }))}
                    >
                      <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
                    </button>
                  )}
                </div>
                {open && subs.length > 0 && (
                  <ul className="ml-3 border-l border-border pl-2">
                    {subs.map((s) => {
                      const sc = productsIn(products, categories, s.id).length;
                      return (
                        <li key={s.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setCategoryId(s.id);
                              setVisible(PAGE);
                            }}
                            className={`block w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                              categoryId === s.id ? "font-medium text-primary" : "text-muted-foreground hover:text-primary"
                            }`}
                          >
                            {s.name}
                            <span className="ml-1 text-xs">({sc})</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="rounded-xl border border-border bg-secondary/50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Need the full shop?</p>
        <p className="mt-1 text-sm text-muted-foreground">Advanced filters and availability live on the shop page.</p>
        <Link to="/shop" search={{}} className="btn-secondary mt-3 inline-flex text-sm">
          Open shop
        </Link>
      </div>
    </aside>
  );

  return (
    <section id="catalogue" className="border-t border-border bg-secondary/40 py-12">
      <div className="container-x">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gold-dark">Product collection</p>
            <h2 className="mt-1 font-display text-3xl font-bold text-primary">{selectedName}</h2>
            <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
              {status === "loading"
                ? "Loading products…"
                : status === "error"
                  ? "Could not load products."
                  : `Showing ${pageItems.length} of ${filtered.length} products`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm lg:hidden"
              onClick={() => setFiltersOpen(true)}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden />
              Categories
            </button>
            <label className="sr-only" htmlFor="home-sort">
              Sort products
            </label>
            <select
              id="home-sort"
              className="rounded-full border border-border bg-card px-4 py-2 text-sm"
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as HomeSort);
                setVisible(PAGE);
              }}
            >
              <option value="newest">Newest arrivals</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
              <option value="name-asc">Name: A–Z</option>
              <option value="name-desc">Name: Z–A</option>
            </select>
            <input
              type="search"
              placeholder="Search products…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setVisible(PAGE);
              }}
              className="w-40 rounded-full border border-border bg-card px-4 py-2 text-sm sm:w-52"
              aria-label="Search products on this page"
            />
          </div>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[240px_1fr]">
          <div className="hidden lg:block">{Sidebar}</div>
          <div>
            {status === "error" && (
              <div role="alert" className="card-elevated p-8 text-center">
                <p className="font-medium text-primary">We could not load the products.</p>
                <button type="button" className="btn-secondary mt-4" onClick={() => void reload()}>
                  Try again
                </button>
              </div>
            )}
            {status === "ready" && filtered.length === 0 && (
              <div className="card-elevated p-10 text-center">
                <p className="font-medium text-primary">No products in this view yet.</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Publish products from the admin dashboard (/dera-owner-console → Load sample products), or clear filters.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-3">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setCategoryId(null);
                      setQ("");
                    }}
                  >
                    Clear filters
                  </button>
                  <Link to="/shop" search={{}} className="btn-primary">
                    Browse shop
                  </Link>
                </div>
              </div>
            )}
            {status === "ready" && pageItems.length > 0 && (
              <>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-5 xl:grid-cols-4">
                  {pageItems.map((p) => (
                    <ProductCard key={p.slug} p={p} />
                  ))}
                </div>
                {hasMore && (
                  <div className="mt-10 text-center">
                    <button type="button" className="btn-secondary" onClick={() => setVisible((v) => v + PAGE)}>
                      Load more products
                    </button>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {filtered.length - pageItems.length} remaining in this view
                    </p>
                  </div>
                )}
              </>
            )}
            {status === "loading" && (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="aspect-[3/4] animate-pulse rounded-xl bg-border/60" />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {filtersOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Categories">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={() => setFiltersOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[min(100%,20rem)] overflow-y-auto bg-card p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <p className="font-semibold text-primary">Categories</p>
              <button type="button" className="text-sm text-muted-foreground" onClick={() => setFiltersOpen(false)}>
                Close
              </button>
            </div>
            {Sidebar}
          </div>
        </div>
      )}
    </section>
  );
}
