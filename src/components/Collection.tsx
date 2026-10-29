import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ProductCard } from "@/components/ProductCard";
import type { Product } from "@/lib/catalog";

export function Collection({ title, intro, items, empty, children }: { title: string; intro?: string; items: Product[]; empty?: string; children?: ReactNode }) {
  return (
    <div className="container-x py-12">
      <h1 className="font-display text-4xl font-bold">{title}</h1>
      {intro && <p className="mt-3 max-w-2xl text-muted-foreground">{intro}</p>}
      {children}
      <p className="mt-6 text-sm text-muted-foreground" aria-live="polite">{items.length} {items.length === 1 ? "product" : "products"} · demo catalogue</p>
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
    </div>
  );
}
