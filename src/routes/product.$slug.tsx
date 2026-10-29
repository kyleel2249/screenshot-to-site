import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { toast } from "sonner";
import { formatGHS, getCategory, getProduct } from "@/lib/catalog";
import { useCart } from "@/lib/cart";

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
          { name: "description", content: loaderData.product.description },
          { property: "og:title", content: loaderData.product.name },
          { property: "og:description", content: loaderData.product.description },
          { property: "og:type", content: "product" },
        ]
      : [{ title: "Product not found — Dera Darko Trade" }, { name: "robots", content: "noindex" }],
  }),
  notFoundComponent: () => (
    <div className="container-x py-20 text-center">
      <h1 className="font-display text-3xl font-bold">Product not found</h1>
      <Link to="/shop" className="btn-secondary mt-6">Back to shop</Link>
    </div>
  ),
  component: ProductPage,
});

function ProductPage() {
  const { product: p } = Route.useLoaderData();
  const { add } = useCart();
  return (
    <div className="container-x grid gap-10 py-12 md:grid-cols-2">
      <img src={p.image} alt={p.name} width={816} height={816} className="w-full rounded-2xl border border-border object-cover" />
      <div>
        <Link to="/shop" search={{ category: p.category }} className="text-sm text-muted-foreground hover:underline">{getCategory(p.category)?.name}</Link>
        <h1 className="mt-2 font-display text-4xl font-bold">{p.name}</h1>
        <div className="mt-4 flex items-baseline gap-3">
          <span className="text-2xl font-semibold text-primary">{formatGHS(p.price)}</span>
          {p.compareAt && <span className="text-muted-foreground line-through">{formatGHS(p.compareAt)}</span>}
        </div>
        <p className="mt-4 text-sm font-medium">
          {p.availability === "preorder" ? <>Preorder · <span className="text-muted-foreground">{p.leadTime}</span></> : "In stock"}
        </p>
        <p className="mt-6 leading-relaxed text-foreground/80">{p.description}</p>
        <button className="btn-primary mt-8 w-full md:w-auto" onClick={() => { add(p.slug); toast.success("Added to cart"); }}>
          {p.availability === "preorder" ? "Preorder now" : "Add to cart"}
        </button>
      </div>
    </div>
  );
}
