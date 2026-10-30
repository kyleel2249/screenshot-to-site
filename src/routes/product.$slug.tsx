import { WishlistButton } from "@/components/WishlistButton";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { useCatalog } from "@/lib/catalog-store";
import { useCart } from "@/lib/cart";
import { useCurrency } from "@/lib/currency";
import { breadcrumb } from "@/lib/domain/categories";
import { AVAILABILITY_LABEL, PROMO_LABEL } from "@/lib/domain/status";
import { Reviews } from "@/components/Reviews";
import { displayPrice, findProduct, isPurchasable } from "@/lib/storefront";

export const Route = createFileRoute("/product/$slug")({
  head: () => ({ meta: [{ title: "Product — Dera Darko Trade" }, { property: "og:type", content: "product" }] }),
  component: ProductPage,
});

function NotFound() {
  return (
    <div className="container-x py-20 text-center">
      <h1 className="font-display text-3xl font-bold">Product not found</h1>
      <p className="mt-2 text-muted-foreground">It may have been removed or is not published yet.</p>
      <Link to="/shop" search={{}} className="btn-secondary mt-6">Back to shop</Link>
    </div>
  );
}

function ProductPage() {
  const { slug } = Route.useParams();
  const { products, categories, status, reload } = useCatalog();
  const { add } = useCart();
  const { mode } = useCurrency();
  if (status === "loading") return <div className="container-x py-20 text-center text-muted-foreground" role="status">Loading…</div>;
  if (status === "error") return <div role="alert" className="container-x py-20 text-center"><p>We couldn't load this product.</p><button className="btn-secondary mt-4" onClick={() => void reload()}>Try again</button></div>;
  const p = findProduct(products, slug);
  if (!p) return <NotFound />;

  const price = displayPrice(p, mode);
  const purchasable = isPurchasable(p);
  const crumbs = breadcrumb(categories, p.categoryId);
  // Title, description, canonical, Open Graph and Product JSON-LD are written into the HTML head by the edge (src/server/seo-inject.ts)
  // from the same database record, so crawlers and link previews see them without running this page.
  return (
    <>
    <div className="container-x grid gap-10 py-12 md:grid-cols-2">
      <img src={p.image} alt={p.imageAlt} width={816} height={816} className="w-full rounded-2xl border border-border object-cover" />
      <div>
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <Link to="/shop" search={{}} className="hover:underline">Shop</Link>
          {crumbs.map((c) => <span key={c.id}> / <Link to="/shop" search={{ category: c.slug }} className="hover:underline">{c.name}</Link></span>)}
        </nav>
        <h1 className="mt-2 font-display text-4xl font-bold">{p.name}</h1>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {p.availability !== "available" && <span className="badge-preorder">{AVAILABILITY_LABEL[p.availability]}</span>}
          {p.labels.map((l) => <span key={l} className="badge-label">{PROMO_LABEL[l]}</span>)}
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
          {p.availability === "pre_order" ? <>Pre-order · <span className="text-muted-foreground">Expected arrival: {p.expectedWindow ?? "to be confirmed"}. Dates are estimates.</span></>
            : p.availability === "available" ? (p.remaining !== undefined ? `Only ${p.remaining} left` : "In stock")
            : AVAILABILITY_LABEL[p.availability]}
        </p>
        <p className="mt-6 leading-relaxed text-foreground/80">{p.shortDescription}</p>
        <button
          className="btn-primary mt-8 w-full md:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!purchasable}
          onClick={() => { const r = add(p.variantId); if (r.ok) toast("Added to cart"); else toast.error(r.reason); }}
        >
          {p.availability === "pre_order" ? "Pre-order now" : purchasable ? "Add to cart" : AVAILABILITY_LABEL[p.availability]}
        </button>
        <div className="mt-3"><WishlistButton slug={p.slug} name={p.name} /></div>
      </div>
    </div>
    <Reviews slug={p.slug} />
    </>
  );
}
