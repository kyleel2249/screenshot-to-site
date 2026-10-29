import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { toast } from "sonner";
import { displayPrice, getProduct, viewOf, categories } from "@/lib/catalog";
import { breadcrumb } from "@/lib/domain/categories";
import { AVAILABILITY_LABEL, PROMO_LABEL, sellableQty } from "@/lib/domain/status";
import { useCart } from "@/lib/cart";
import { useCurrency } from "@/lib/currency";

export const Route = createFileRoute("/product/$slug")({
  loader: ({ params }) => {
    const product = getProduct(params.slug);
    if (!product) throw notFound();
    return { product };
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.product.name} — Dera Darko Trade` },
          { name: "description", content: loaderData.product.shortDescription },
          { property: "og:title", content: loaderData.product.name },
          { property: "og:description", content: loaderData.product.shortDescription },
          { property: "og:type", content: "product" },
        ]
      : [{ title: "Product not found — Dera Darko Trade" }, { name: "robots", content: "noindex" }],
  }),
  notFoundComponent: () => (
    <div className="container-x py-20 text-center">
      <h1 className="font-display text-3xl font-bold">Product not found</h1>
      <Link to="/shop" search={{}} className="btn-secondary mt-6">Back to shop</Link>
    </div>
  ),
  component: ProductPage,
});

function ProductPage() {
  const { product: p } = Route.useLoaderData();
  const { add } = useCart();
  const { mode } = useCurrency();
  const view = viewOf(p);
  const price = displayPrice(p, mode);
  const v = p.variants[0]!;
  const purchasable = view.availability === "available" || view.availability === "pre_order";
  const crumbs = breadcrumb(categories, p.categoryId);
  const showQty = p.showLimitedBelow !== undefined && v.trackInventory && sellableQty(v) > 0 && sellableQty(v) <= p.showLimitedBelow;

  // Structured data mirrors the visible price/availability exactly.
  const ghs = (v.salePrice ?? v.price).GHS;
  const ld = {
    "@context": "https://schema.org", "@type": "Product", name: p.name, description: p.shortDescription,
    ...(ghs !== undefined ? { offers: { "@type": "Offer", priceCurrency: "GHS", price: (ghs / 100).toFixed(2), availability: view.availability === "available" ? "https://schema.org/InStock" : view.availability === "pre_order" ? "https://schema.org/PreOrder" : "https://schema.org/OutOfStock" } } : {}),
  };

  return (
    <div className="container-x grid gap-10 py-12 md:grid-cols-2">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <img src={p.image} alt={p.imageAlt} width={816} height={816} className="w-full rounded-2xl border border-border object-cover" />
      <div>
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <Link to="/shop" search={{}} className="hover:underline">Shop</Link>
          {crumbs.map((c) => <span key={c.id}> / <Link to="/shop" search={{ category: c.slug }} className="hover:underline">{c.name}</Link></span>)}
        </nav>
        <h1 className="mt-2 font-display text-4xl font-bold">{p.name}</h1>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {view.availability !== "available" && <span className="badge-preorder">{AVAILABILITY_LABEL[view.availability]}</span>}
          {view.labels.map((l) => <span key={l} className="badge-label">{PROMO_LABEL[l]}</span>)}
        </div>
        <div className="mt-4 space-y-1">
          {price.current.map((c, i) => (
            <div key={c.text} className="flex items-baseline gap-3">
              <span className="text-2xl font-semibold text-primary">{c.text}</span>
              {price.original[i] && <span className="text-muted-foreground line-through">{price.original[i]!.text}</span>}
            </div>
          ))}
          {price.current.length === 0 && <span className="text-muted-foreground">Price on request</span>}
        </div>
        <p className="mt-4 text-sm font-medium" role="status">
          {view.availability === "pre_order" ? <>Pre-order · <span className="text-muted-foreground">Expected arrival: {p.expectedWindow ?? "to be confirmed"}. Dates are estimates.</span></>
            : view.availability === "available" ? (showQty ? `Only ${sellableQty(v)} left` : "In stock")
            : AVAILABILITY_LABEL[view.availability]}
        </p>
        <p className="mt-6 leading-relaxed text-foreground/80">{p.description}</p>
        {Object.keys(p.attributes).length > 0 && (
          <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            {Object.entries(p.attributes).map(([k, val]) => <div key={k} className="contents"><dt className="font-medium text-primary">{k}</dt><dd>{val}</dd></div>)}
          </dl>
        )}
        <button
          className="btn-primary mt-8 w-full md:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!purchasable}
          onClick={() => { const r = add(v.id); if (r.ok) toast("Added to cart"); else toast.error(r.reason); }}
        >
          {view.availability === "pre_order" ? "Pre-order now" : purchasable ? "Add to cart" : AVAILABILITY_LABEL[view.availability]}
        </button>
      </div>
    </div>
  );
}
