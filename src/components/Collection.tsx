import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ProductCard } from "@/components/ProductCard";
import { useCatalog } from "@/lib/catalog-store";
import type { StoreProduct } from "@/lib/storefront";

export function Collection({ title, intro, items, empty, children }: { title: string; intro?: string | undefined; items: StoreProduct[]; empty?: string; children?: ReactNode }) {
  const { status, reload } = useCatalog();
  return (
    <div className="container-x py-12">
      <h1 className="font-display text-4xl font-bold">{title}</h1>
      {intro && <p className="mt-3 max-w-2xl text-muted-foreground">{intro}</p>}
      {children}
      {status === "loading" && <p className="mt-6 text-sm text-muted-foreground" role="status">Loading products…</p>}
      {status === "error" && (
        <div role="alert" className="card-elevated mt-6 p-8 text-center">
          <p className="font-medium text-primary">We couldn't load the products.</p>
          <button className="btn-secondary mt-4" onClick={() => void reload()}>Try again</button>
        </div>
      )}
      {status === "ready" && (
        <>
          <p className="mt-6 text-sm text-muted-foreground" aria-live="polite">{items.length} {items.length === 1 ? "product" : "products"}</p>
          {items.length === 0 ? (
            <div className="card-elevated mt-6 p-10 text-center">
              <p className="font-medium text-primary">{empty ?? "Nothing here yet."}</p>
              <Link to="/shop" search={{}} className="btn-secondary mt-4">Browse all products</Link>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 md:gap-6">
              {items.map((p) => <ProductCard key={p.slug} p={p} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** A collection page whose items are picked from the live catalogue. */
export function CatalogCollection({ title, intro, pick, empty }: { title: string; intro?: string | undefined; pick: (all: StoreProduct[]) => StoreProduct[]; empty?: string }) {
  const { products } = useCatalog();
  return <Collection title={title} {...(intro ? { intro } : {})} items={pick(products)} {...(empty ? { empty } : {})} />;
}
