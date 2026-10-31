import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, Truck, Package, Headphones } from "lucide-react";
import hero from "@/assets/hero.jpg";
import { useCatalog } from "@/lib/catalog-store";
import { hasLabel, productsIn, sortProducts } from "@/lib/storefront";
import { topLevel } from "@/lib/domain/categories";
import { ProductCard } from "@/components/ProductCard";

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
  const totalReady = status === "ready" ? products.length : 0;
  const trust = [
    { icon: ShieldCheck, t: "Secure checkout", d: "Payment details are never stored on our site." },
    { icon: Truck, t: "Delivery in Ghana", d: "Delivery options confirmed at checkout." },
    { icon: Package, t: "Pre-orders", d: "Clear lead times shown on every pre-order item." },
    { icon: Headphones, t: "Real support", d: "Talk to our team before and after you buy." },
  ];
  return (
    <>
      <section className="bg-gradient-navy text-primary-foreground">
        <div className="container-x grid items-center gap-10 py-16 md:grid-cols-2 md:py-24">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">Imported · Curated · Delivered</p>
            <h1 className="mt-4 font-display text-4xl font-bold leading-tight text-primary-foreground md:text-6xl">
              Everything you need. All in one place.
            </h1>
            <p className="mt-5 max-w-md text-primary-foreground/75">
              Browse the full catalogue in cedis, dollars or both — in-stock items and pre-orders for shoppers and businesses.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link to="/shop" search={{}} className="btn-primary">
                Shop all products
              </Link>
              <Link to="/shop" search={{}} className="rounded-full border border-primary-foreground/30 px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary-foreground/10">
                Explore categories
              </Link>
            </div>
            {totalReady > 0 && (
              <p className="mt-4 text-sm text-primary-foreground/60">
                {totalReady} product{totalReady === 1 ? "" : "s"} in the catalogue
              </p>
            )}
          </div>
          <img src={hero} alt="Selection of imported products" width={1600} height={1104} className="w-full rounded-2xl shadow-2xl" />
        </div>
      </section>

      <section className="container-x py-16">
        <div className="flex items-end justify-between gap-4">
          <h2 className="font-display text-3xl font-bold">Shop by category</h2>
          <Link to="/shop" search={{}} className="text-sm font-medium text-primary hover:underline">
            View full catalogue
          </Link>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {topLevel(categories).map((c) => (
            <Link key={c.id} to="/shop" search={{ category: c.slug }} className="group card-elevated p-5 transition-shadow hover:shadow-lg">
              <p className="font-semibold text-primary group-hover:underline">{c.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">{c.description}</p>
              <p className="mt-3 text-xs font-medium text-gold-dark">
                {status === "ready"
                  ? `${productsIn(products, categories, c.id).length} ${productsIn(products, categories, c.id).length === 1 ? "product" : "products"}`
                  : "\u00a0"}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section className="bg-secondary py-16">
        <div className="container-x">
          <div className="flex items-end justify-between">
            <h2 className="font-display text-3xl font-bold">New arrivals</h2>
            <Link to="/new-arrivals" className="text-sm font-medium text-primary hover:underline">
              View all
            </Link>
          </div>
          {status === "ready" && arrivals.length === 0 && (
            <p className="mt-8 text-muted-foreground">New products will appear here soon.</p>
          )}
          <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
            {arrivals.map((p) => (
              <ProductCard key={p.slug} p={p} />
            ))}
          </div>
        </div>
      </section>

      <section className="container-x grid gap-6 py-16 sm:grid-cols-2 lg:grid-cols-4">
        {trust.map(({ icon: Icon, t, d }) => (
          <div key={t} className="flex gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-gold">
              <Icon className="h-5 w-5" />
            </span>
            <div>
              <p className="font-semibold text-primary">{t}</p>
              <p className="text-sm text-muted-foreground">{d}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="container-x pb-16">
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
