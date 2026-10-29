import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, Truck, Package, Headphones } from "lucide-react";
import hero from "@/assets/hero.jpg";
import { categories, products } from "@/lib/catalog";
import { ProductCard } from "@/components/ProductCard";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dera Darko Trade — Quality Imports in Ghana" },
      { name: "description", content: "Shop imported electronics, home and fashion in GH₵. In-stock items and preorders for shoppers, resellers and wholesale buyers." },
      { property: "og:title", content: "Dera Darko Trade — Quality Imports in Ghana" },
      { property: "og:description", content: "Imported products, transparent GH₵ pricing, preorders and wholesale." },
    ],
  }),
  component: Index,
});

function Index() {
  const trust = [
    { icon: ShieldCheck, t: "Secure checkout", d: "Payment details are never stored on our site." },
    { icon: Truck, t: "Delivery in Ghana", d: "Delivery options confirmed at checkout." },
    { icon: Package, t: "Preorders", d: "Clear lead times shown on every preorder item." },
    { icon: Headphones, t: "Real support", d: "Talk to our team before and after you buy." },
  ];
  return (
    <>
      <section className="bg-gradient-navy text-primary-foreground">
        <div className="container-x grid items-center gap-10 py-16 md:grid-cols-2 md:py-24">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">Imported · Curated · Delivered</p>
            <h1 className="mt-4 font-display text-4xl font-bold leading-tight text-primary-foreground md:text-6xl">
              Quality imports, priced clearly in cedis.
            </h1>
            <p className="mt-5 max-w-md text-primary-foreground/75">
              Shop in-stock products or preorder from abroad — for your home, your style or your business.
            </p>
            <div className="mt-8 flex items-center gap-6">
              <Link to="/shop" className="btn-primary">Shop now</Link>
              <Link to="/wholesale" className="text-sm font-medium underline-offset-4 hover:underline">Buying in bulk?</Link>
            </div>
          </div>
          <img src={hero} alt="Selection of imported products" width={1600} height={1104} className="w-full rounded-2xl shadow-2xl" />
        </div>
      </section>

      <section className="container-x py-16">
        <h2 className="font-display text-3xl font-bold">Shop by category</h2>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {categories.map((c) => (
            <Link key={c.slug} to="/shop" search={{ category: c.slug }} className="group card-elevated overflow-hidden">
              <img src={c.image} alt={c.name} loading="lazy" width={816} height={816} className="aspect-[4/3] w-full object-cover transition-transform duration-500 group-hover:scale-105" />
              <div className="p-5">
                <p className="font-semibold text-primary">{c.name}</p>
                <p className="text-sm text-muted-foreground">{c.description} · {products.filter((p) => p.category === c.slug).length} items</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="bg-secondary py-16">
        <div className="container-x">
          <div className="flex items-end justify-between">
            <h2 className="font-display text-3xl font-bold">New arrivals</h2>
            <Link to="/shop" className="text-sm font-medium text-primary hover:underline">View all</Link>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
            {products.slice(0, 4).map((p) => <ProductCard key={p.slug} p={p} />)}
          </div>
        </div>
      </section>

      <section className="container-x grid gap-6 py-16 sm:grid-cols-2 lg:grid-cols-4">
        {trust.map(({ icon: Icon, t, d }) => (
          <div key={t} className="flex gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-gold"><Icon className="h-5 w-5" /></span>
            <div><p className="font-semibold text-primary">{t}</p><p className="text-sm text-muted-foreground">{d}</p></div>
          </div>
        ))}
      </section>

      <section className="container-x">
        <div className="bg-gradient-navy rounded-2xl p-10 text-primary-foreground md:flex md:items-center md:justify-between">
          <div>
            <h2 className="font-display text-3xl font-bold text-primary-foreground">Resell or buy for your business?</h2>
            <p className="mt-2 text-primary-foreground/75">Ask about wholesale quantities and business pricing.</p>
          </div>
          <Link to="/wholesale" className="btn-primary mt-6 md:mt-0">Wholesale enquiry</Link>
        </div>
      </section>
    </>
  );
}
