import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { findBySlug } from "@/lib/catalog";
import { useCatalog } from "@/lib/catalog-store";
import { productsIn, search, sortProducts } from "@/lib/storefront";
import { childrenOf, topLevel, breadcrumb } from "@/lib/domain/categories";
import { AVAILABILITY_LABEL } from "@/lib/domain/status";
import { facets, filterByAttributes, parseFilterParams, toFilterParams } from "@/lib/domain/attributes";
import { Collection } from "@/components/Collection";

type Sort = "newest" | "price-asc" | "price-desc";
interface Search { category?: string | undefined; q?: string | undefined; availability?: string | undefined; sort?: Sort | undefined; f?: string[] | undefined }

export const Route = createFileRoute("/shop")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    category: typeof s["category"] === "string" ? (s["category"] as string) : undefined,
    q: typeof s["q"] === "string" ? (s["q"] as string) : undefined,
    availability: typeof s["availability"] === "string" ? (s["availability"] as string) : undefined,
    f: Array.isArray(s["f"]) ? (s["f"] as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 8) : typeof s["f"] === "string" ? [s["f"] as string] : undefined,
    sort: s["sort"] === "price-asc" || s["sort"] === "price-desc" || s["sort"] === "newest" ? (s["sort"] as Sort) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Shop — Dera Darko Trade" },
      { name: "description", content: "Browse imported products across fashion, phones, home, beauty and more." },
      { property: "og:title", content: "Shop — Dera Darko Trade" },
      { property: "og:description", content: "Browse in-stock and pre-order imports." },
    ],
  }),
  component: Shop,
});

function Shop() {
  const { category, q, availability, sort, f } = Route.useSearch();
  const navigate = useNavigate({ from: "/shop" });
  const { products, categories } = useCatalog();
  const cat = category ? findBySlug(categories, category) : undefined;
  let list = search(productsIn(products, categories, cat?.id), q ?? "", categories);
  if (availability) list = list.filter((p) => p.availability === availability);
  // Attribute filters (make/year for cars, size for shoes, …) apply to the profile of the chosen category branch.
  const profile = cat?.filterProfile;
  const selected = parseFilterParams(f, profile);
  // Each facet shows values from the list filtered by the OTHER selections, so choices never lead to an empty result.
  const facetsFor = cat ? facets(list, profile).map((fc) => ({ ...fc, values: facets(filterByAttributes(list, { ...selected, [fc.key]: "" }), profile).find((x) => x.key === fc.key)?.values ?? [] })) : [];
  list = filterByAttributes(list, selected);
  list = sortProducts(list, sort);

  const pill = (active: boolean) => `rounded-full border px-4 py-1.5 text-sm transition-colors ${active ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary"}`;
  const subs = cat ? childrenOf(categories, cat.parentId ?? cat.id) : [];
  const crumbs = cat ? breadcrumb(categories, cat.id) : [];

  return (
    <Collection title={cat ? cat.name : "Shop"} intro={cat?.description} items={list} empty="No products match these filters.">
      {crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mt-3 text-sm text-muted-foreground">
          <Link to="/shop" search={{}} className="hover:underline">Shop</Link>
          {crumbs.map((c) => <span key={c.id}> / <Link to="/shop" search={{ category: c.slug }} className="hover:underline">{c.name}</Link></span>)}
        </nav>
      )}
      <div className="mt-6 flex flex-wrap gap-2" aria-label="Categories">
        <Link to="/shop" search={{}} className={pill(!category)}>All</Link>
        {topLevel(categories).map((c) => (
          <Link key={c.id} to="/shop" search={{ category: c.slug }} className={pill(cat?.id === c.id || cat?.parentId === c.id)}>{c.name}</Link>
        ))}
      </div>
      {subs.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2" aria-label="Subcategories">
          {subs.map((c) => <Link key={c.id} to="/shop" search={{ category: c.slug }} className={pill(cat?.id === c.id)}>{c.name}</Link>)}
        </div>
      )}
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <label className="text-sm">Search
          <input className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2" defaultValue={q ?? ""} placeholder="Product name or SKU"
            onKeyDown={(e) => { if (e.key === "Enter") navigate({ search: (s) => ({ ...s, q: e.currentTarget.value || undefined }) }); }} />
        </label>
        <label className="text-sm">Availability
          <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2" value={availability ?? ""} onChange={(e) => navigate({ search: (s) => ({ ...s, availability: e.target.value || undefined }) })}>
            <option value="">All</option>
            {(["available", "pre_order", "out_of_stock", "coming_soon"] as const).map((a) => <option key={a} value={a}>{AVAILABILITY_LABEL[a]}</option>)}
          </select>
        </label>
        <label className="text-sm">Sort by
          <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2" value={sort ?? "newest"} onChange={(e) => navigate({ search: (s) => ({ ...s, sort: e.target.value as Sort }) })}>
            <option value="newest">Newest</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option>
          </select>
        </label>
      </div>
      {facetsFor.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-4" role="group" aria-label="Filter by details">
          {facetsFor.map((fc) => (
            <label key={fc.key} className="text-sm">{fc.label}
              <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2" value={selected[fc.key] ?? ""}
                onChange={(e) => navigate({ search: (s) => { const next = { ...parseFilterParams(s.f, profile), [fc.key]: e.target.value }; const arr = toFilterParams(next); return { ...s, f: arr.length ? arr : undefined }; } })}>
                <option value="">Any</option>
                {fc.values.map((v) => <option key={v.value} value={v.value}>{v.value} ({v.count})</option>)}
              </select>
            </label>))}
        </div>)}
      {(q || availability || sort || (f && f.length > 0)) && <Link to="/shop" search={category ? { category } : {}} className="mt-3 inline-block text-sm text-primary hover:underline">Clear filters</Link>}
    </Collection>
  );
}
