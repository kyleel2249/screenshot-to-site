/**
 * Shop / collection — database-driven catalogue with left sidebar filters.
 * Visual reference: multi-column product grid + category sidebar (Dera Darko navy/gold identity; no green UI).
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronDown, Filter, X } from "lucide-react";
import { findBySlug } from "@/lib/catalog";
import { useCatalog } from "@/lib/catalog-store";
import { productsIn, search, sortProducts, type StoreProduct } from "@/lib/storefront";
import { childrenOf, topLevel, breadcrumb } from "@/lib/domain/categories";
import { AVAILABILITY_LABEL } from "@/lib/domain/status";
import { facets, filterByAttributes, parseFilterParams, toFilterParams } from "@/lib/domain/attributes";
import { ProductCard } from "@/components/ProductCard";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

type Sort = "newest" | "price-asc" | "price-desc" | "name-asc" | "name-desc";
interface Search {
  category?: string | undefined;
  q?: string | undefined;
  availability?: string | undefined;
  sort?: Sort | undefined;
  f?: string[] | undefined;
  page?: number | undefined;
}

const PAGE_SIZE = 24;

export const Route = createFileRoute("/shop")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    category: typeof s["category"] === "string" ? (s["category"] as string) : undefined,
    q: typeof s["q"] === "string" ? (s["q"] as string) : undefined,
    availability: typeof s["availability"] === "string" ? (s["availability"] as string) : undefined,
    f: Array.isArray(s["f"])
      ? (s["f"] as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 8)
      : typeof s["f"] === "string"
        ? [s["f"] as string]
        : undefined,
    sort:
      s["sort"] === "price-asc" ||
      s["sort"] === "price-desc" ||
      s["sort"] === "newest" ||
      s["sort"] === "name-asc" ||
      s["sort"] === "name-desc"
        ? (s["sort"] as Sort)
        : undefined,
    page: typeof s["page"] === "number" && s["page"] >= 1 ? Math.floor(s["page"] as number) : typeof s["page"] === "string" && /^\d+$/.test(s["page"]) ? Math.max(1, parseInt(s["page"], 10)) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Shop — Dera Darko Trade" },
      { name: "description", content: "Browse the full Dera Darko Trade catalogue — fashion, phones, home, beauty and more. Prices in GH₵ and USD." },
      { property: "og:title", content: "Shop — Dera Darko Trade" },
      { property: "og:description", content: "Complete product catalogue with GH₵ and USD pricing." },
    ],
  }),
  component: Shop,
});

function sortList(list: StoreProduct[], sort: Sort | undefined): StoreProduct[] {
  if (sort === "name-asc") return [...list].sort((a, b) => a.name.localeCompare(b.name));
  if (sort === "name-desc") return [...list].sort((a, b) => b.name.localeCompare(a.name));
  return sortProducts(list, sort === "price-asc" || sort === "price-desc" || sort === "newest" ? sort : "newest");
}

function Shop() {
  const { category, q, availability, sort, f, page: pageParam } = Route.useSearch();
  const navigate = useNavigate({ from: "/shop" });
  const { products, categories, status, reload } = useCatalog();
  const [filterOpen, setFilterOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const cat = category ? findBySlug(categories, category) : undefined;
  const profile = cat?.filterProfile;
  const selected = parseFilterParams(f, profile);

  const filtered = useMemo(() => {
    let list = search(productsIn(products, categories, cat?.id), q ?? "", categories);
    if (availability) list = list.filter((p) => p.availability === availability);
    list = filterByAttributes(list, selected);
    return sortList(list, sort);
  }, [products, categories, cat, q, availability, selected, sort]);

  const page = pageParam ?? 1;
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice(0, safePage * PAGE_SIZE);
  const hasMore = pageItems.length < total;

  const tops = topLevel(categories);
  const crumbs = cat ? breadcrumb(categories, cat.id) : [];
  const facetsFor = cat
    ? facets(filtered, profile).map((fc) => ({
        ...fc,
        values:
          facets(filterByAttributes(search(productsIn(products, categories, cat?.id), q ?? "", categories), { ...selected, [fc.key]: "" }), profile).find(
            (x) => x.key === fc.key,
          )?.values ?? [],
      }))
    : [];

  const setSearch = (patch: Partial<Search>) =>
    navigate({
      search: (s) => {
        const next = { ...s, ...patch, page: patch.page ?? 1 };
        return next;
      },
    });

  const clearFilters = () => navigate({ search: category ? { category } : {} });

  const Sidebar = (
    <aside className="space-y-6" aria-label="Catalogue filters">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Categories</p>
        <ul className="mt-3 space-y-0.5 text-sm">
          <li>
            <Link
              to="/shop"
              search={{}}
              className={`block rounded-md px-3 py-2 transition-colors ${!category ? "bg-primary text-primary-foreground" : "text-foreground/80 hover:bg-gold/15 hover:text-primary"}`}
            >
              All Products
            </Link>
          </li>
          {tops.map((c) => {
            const subs = childrenOf(categories, c.id);
            const count = productsIn(products, categories, c.id).length;
            const active = cat?.id === c.id || cat?.parentId === c.id;
            const open = expanded[c.id] ?? active;
            return (
              <li key={c.id}>
                <div className="flex items-center gap-1">
                  <Link
                    to="/shop"
                    search={{ category: c.slug }}
                    className={`flex-1 rounded-md px-3 py-2 transition-colors ${active ? "bg-primary/10 font-medium text-primary" : "text-foreground/80 hover:bg-gold/15 hover:text-primary"}`}
                  >
                    {c.name}
                    <span className="ml-1 text-xs text-muted-foreground">({count})</span>
                  </Link>
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
                          <Link
                            to="/shop"
                            search={{ category: s.slug }}
                            className={`block rounded-md px-2 py-1.5 text-sm transition-colors ${cat?.id === s.id ? "font-medium text-primary" : "text-muted-foreground hover:text-primary"}`}
                          >
                            {s.name} <span className="text-xs">({sc})</span>
                          </Link>
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

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Availability</p>
        <select
          className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={availability ?? ""}
          onChange={(e) => setSearch({ availability: e.target.value || undefined })}
        >
          <option value="">All</option>
          {(["available", "pre_order", "out_of_stock", "coming_soon"] as const).map((a) => (
            <option key={a} value={a}>
              {AVAILABILITY_LABEL[a]}
            </option>
          ))}
        </select>
      </div>

      {facetsFor.length > 0 && (
        <div className="space-y-3" role="group" aria-label="Product details">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Details</p>
          {facetsFor.map((fc) => (
            <label key={fc.key} className="block text-sm">
              {fc.label}
              <select
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={selected[fc.key] ?? ""}
                onChange={(e) =>
                  setSearch({
                    f: (() => {
                      const next = { ...selected, [fc.key]: e.target.value };
                      const arr = toFilterParams(next);
                      return arr.length ? arr : undefined;
                    })(),
                  })
                }
              >
                <option value="">Any</option>
                {fc.values.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.value} ({v.count})
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}

      {(q || availability || (f && f.length > 0) || sort) && (
        <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          <X className="h-3.5 w-3.5" aria-hidden /> Clear filters
        </button>
      )}
    </aside>
  );

  return (
    <div className="bg-cloud min-h-[60vh]">
      <div className="container-x py-8 md:py-10">
        {crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
            <Link to="/shop" search={{}} className="hover:text-primary hover:underline">
              Shop
            </Link>
            {crumbs.map((c) => (
              <span key={c.id}>
                {" / "}
                <Link to="/shop" search={{ category: c.slug }} className="hover:text-primary hover:underline">
                  {c.name}
                </Link>
              </span>
            ))}
          </nav>
        )}

        <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
          {/* Desktop sidebar */}
          <div className="hidden w-64 shrink-0 lg:block">{Sidebar}</div>

          {/* Main collection */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-gold-dark">Collection view</p>
                <h1 className="mt-1 font-display text-3xl font-bold text-primary md:text-4xl">{cat ? cat.name : "All Products"}</h1>
                {cat?.description && <p className="mt-1 max-w-xl text-sm text-muted-foreground">{cat.description}</p>}
                <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">
                  {status === "ready"
                    ? `Showing ${pageItems.length} of ${total} product${total === 1 ? "" : "s"}`
                    : status === "loading"
                      ? "Loading products…"
                      : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-primary lg:hidden"
                  onClick={() => setFilterOpen(true)}
                >
                  <Filter className="h-4 w-4" aria-hidden /> Filters
                </button>
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Sort by</span>
                  <select
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={sort ?? "newest"}
                    onChange={(e) => setSearch({ sort: e.target.value as Sort })}
                  >
                    <option value="newest">Newest</option>
                    <option value="price-asc">Price: low to high</option>
                    <option value="price-desc">Price: high to low</option>
                    <option value="name-asc">Name: A–Z</option>
                    <option value="name-desc">Name: Z–A</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="mt-4">
              <label className="sr-only" htmlFor="shop-search">
                Search products
              </label>
              <input
                id="shop-search"
                className="w-full max-w-md rounded-md border border-input bg-background px-3 py-2 text-sm"
                defaultValue={q ?? ""}
                placeholder="Search by name or SKU"
                onKeyDown={(e) => {
                  if (e.key === "Enter") setSearch({ q: e.currentTarget.value || undefined });
                }}
              />
            </div>

            {status === "error" && (
              <div role="alert" className="card-elevated mt-8 p-8 text-center">
                <p className="font-medium text-primary">We couldn't load the products.</p>
                <button type="button" className="btn-secondary mt-4" onClick={() => void reload()}>
                  Try again
                </button>
              </div>
            )}

            {status === "ready" && pageItems.length === 0 && (
              <div className="card-elevated mt-8 p-10 text-center">
                <p className="font-medium text-primary">No products match these filters.</p>
                <button type="button" className="btn-secondary mt-4" onClick={clearFilters}>
                  Clear filters
                </button>
              </div>
            )}

            {status === "ready" && pageItems.length > 0 && (
              <>
                <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 md:gap-6">
                  {pageItems.map((p) => (
                    <ProductCard key={p.slug} p={p} />
                  ))}
                </div>
                {hasMore && (
                  <div className="mt-10 flex justify-center">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => setSearch({ page: safePage + 1 })}
                    >
                      Load more products
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mobile filter drawer */}
      <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
        <SheetContent side="left" className="w-[85vw] max-w-sm overflow-y-auto bg-background p-5">
          <SheetHeader className="text-left">
            <SheetTitle className="font-display text-primary">Filters</SheetTitle>
            <SheetDescription className="sr-only">Category and product filters</SheetDescription>
          </SheetHeader>
          <div className="mt-6">{Sidebar}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
