import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, Truck, Package, Headphones } from "lucide-react";
import hero from "@/assets/hero.jpg";
import { useCatalog } from "@/lib/catalog-store";
import { hasLabel, productsIn, sortProducts } from "@/lib/storefront";
import { topLevel } from "@/lib/domain/categories";
import { ProductCard } from "@/components/ProductCard";
import { HomeCatalogue } from "@/components/HomeCatalogue";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dera Darko Trade — Quality Imports in Ghana" },
      {
        name: "description",
        content: "Shop the full Dera Darko Trade catalogue — fashion, phones, home, beauty and more. Clear GH₵ and USD pricing.",
      },
      { property: "og:title", content: "Dera Darko Trade — Quality Imports in Ghana" },
      { property: "og:description", content: "Imported products, transparent GH₵ and USD pricing, pre-orders and wholesale." },
    ],
  }),
  component: Index,
});

function Index() {
  const { products, categories, status } = useCatalog();
  const fresh = sortProducts(
    products.filter((p) => hasLabel(p, "new_arrival") || hasLabel(p, "just_landed")),
    "newest",
  );
  const arrivals = (fresh.length ? fresh : sortProducts(products, "newest")).slice(0, 4);
  const tops = topLevel(categories);
  const trust = [
    { icon: ShieldCheck, t: "Secure checkout", d: "Payment details are never stored on our site." },
    { icon: Truck, t: "Delivery in Ghana", d: "Delivery options confirmed at checkout." },
    { icon: Package, t: "Pre-orders", d: "Clear lead times shown on every pre-order item." },
    { icon: Headphones, t: "Real support", d: "Talk to our team before and after you buy." },
  ];
  return (
    <>
      <div className="border-b border-border bg-primary text-center text-sm text-primary-foreground">
        <p className="container-x py-2">Welcome to Dera Darko Trade — quality products with clear GH₵ and USD pricing.</p>
      </div>

      <section className="bg-gradient-navy text-primary-foreground">
        <div className="container-x grid items-center gap-10 py-14 md:grid-cols-2 md:py-20">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">Imported · Curated · Delivered</p>
            <h1 className="mt-4 font-display text-4xl font-bold leading-tight text-primary-foreground md:text-5xl lg:text-6xl">
              Everything you need. All in one place.
            </h1>
            <p className="mt-5 max-w-md text-primary-foreground/75">
              Browse the full catalogue in cedis, dollars or both — in-stock items and pre-orders for shoppers across Ghana.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#catalogue" className="btn-primary">
                Shop now
              </a>
              <a
                href="#categories"
                className="rounded-full border border-primary-foreground/30 px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary-foreground/10"
              >
                Explore categories
              </a>
            </div>
          </div>
          <div className="relative overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/10">
            <img src={hero} alt="Dera Darko Trade product selection" className="aspect-[4/3] w-full object-cover" />
          </div>
        </div>
      </section>

      <section id="categories" className="container-x py-12">
        <div className="flex items-end justify-between gap-4">
          <h2 className="font-display text-2xl font-bold text-primary md:text-3xl">Shop by category</h2>
          <Link to="/shop" search={{}} className="text-sm font-medium text-primary hover:underline">
            View all
          </Link>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {tops.map((c) => (
            <Link
              key={c.id}
              to="/shop"
              search={{ category: c.slug }}
              className="group rounded-xl border border-border bg-card p-4 text-left shadow-sm transition hover:border-gold hover:shadow-md"
            >
              <p className="font-semibold text-primary group-hover:underline">{c.name}</p>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{c.description}</p>
              <p className="mt-3 text-xs font-medium text-gold-dark">
                {status === "ready"
                  ? `${productsIn(products, categories, c.id).length} ${productsIn(products, categories, c.id).length === 1 ? "product" : "products"}`
                  : "\u00a0"}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <HomeCatalogue />

      {arrivals.length > 0 && (
        <section className="container-x py-14">
          <div className="flex items-end justify-between">
            <h2 className="font-display text-2xl font-bold text-primary md:text-3xl">New arrivals</h2>
            <Link to="/new-arrivals" className="text-sm font-medium text-primary hover:underline">
              View all
            </Link>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
            {arrivals.map((p) => (
              <ProductCard key={p.slug} p={p} />
            ))}
          </div>
        </section>
      )}

      <section className="border-t border-border bg-card py-14">
        <div className="container-x grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {trust.map(({ icon: Icon, t, d }) => (
            <div key={t} className="flex gap-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-gold">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <p className="font-semibold text-primary">{t}</p>
                <p className="text-sm text-muted-foreground">{d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="container-x py-14">
        <div className="bg-gradient-navy rounded-2xl p-10 text-primary-foreground md:flex md:items-center md:justify-between">
          <div>
            <h2 className="font-display text-3xl font-bold text-primary-foreground">Resell or buy for your business?</h2>
            <p className="mt-2 text-primary-foreground/75">Ask about wholesale quantities and business pricing.</p>
          </div>
          <Link to="/wholesale" className="btn-primary mt-6 md:mt-0">
            Wholesale enquiry
          </Link>
        </div>
      </section>
    </>
  );
}
