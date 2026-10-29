import { createFileRoute, Link } from "@tanstack/react-router";
import { categories, products } from "@/lib/catalog";
import { ProductCard } from "@/components/ProductCard";

export const Route = createFileRoute("/shop")({
  validateSearch: (s: Record<string, unknown>): { category?: string } => ({
    category: typeof s["category"] === "string" ? (s["category"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Shop — Dera Darko Trade" },
      { name: "description", content: "Browse imported electronics, home & kitchen and fashion products priced in GH₵." },
      { property: "og:title", content: "Shop — Dera Darko Trade" },
      { property: "og:description", content: "Browse in-stock and preorder imports." },
    ],
  }),
  component: Shop,
});

function Shop() {
  const { category } = Route.useSearch();
  const list = category ? products.filter((p) => p.category === category) : products;
  const pill = (active: boolean) =>
    `rounded-full border px-4 py-1.5 text-sm transition-colors ${active ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary"}`;
  return (
    <div className="container-x py-12">
      <h1 className="font-display text-4xl font-bold">Shop</h1>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link to="/shop" search={{}} className={pill(!category)}>All</Link>
        {categories.map((c) => (
          <Link key={c.slug} to="/shop" search={{ category: c.slug }} className={pill(category === c.slug)}>{c.name}</Link>
        ))}
      </div>
      <p className="mt-6 text-sm text-muted-foreground">{list.length} products · demo catalogue</p>
      <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 md:gap-6">
        {list.map((p) => <ProductCard key={p.slug} p={p} />)}
      </div>
    </div>
  );
}
