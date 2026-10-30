import { Link } from "@tanstack/react-router";
import { Stars } from "@/components/Reviews";
import { toast } from "sonner";
import { displayPrice, isPurchasable, type StoreProduct } from "@/lib/storefront";
import { useCart } from "@/lib/cart";
import { useCurrency } from "@/lib/currency";
import { AVAILABILITY_LABEL, PROMO_LABEL } from "@/lib/domain/status";

export function ProductCard({ p }: { p: StoreProduct }) {
  const { add } = useCart();
  const { mode } = useCurrency();
  const view = p;
  const price = displayPrice(p, mode);
  const purchasable = isPurchasable(p);
  const cta = view.availability === "pre_order" ? "Pre-order" : view.availability === "coming_soon" ? "Coming soon" : "Add to cart";
  const variantId = p.variantId;
  return (
    <article className="group card-elevated overflow-hidden flex flex-col">
      <Link to="/product/$slug" params={{ slug: p.slug }} className="relative block aspect-square overflow-hidden bg-muted">
        <img src={p.image} alt={p.imageAlt} loading="lazy" width={816} height={816} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
        <span className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          {view.availability !== "available" && <span className="badge-preorder">{AVAILABILITY_LABEL[view.availability]}</span>}
          {view.labels.map((l) => <span key={l} className="badge-label">{PROMO_LABEL[l]}</span>)}
        </span>
      </Link>
      <div className="flex flex-1 flex-col p-4">
        <Link to="/product/$slug" params={{ slug: p.slug }} className="font-medium text-foreground hover:underline">{p.name}</Link>
        {p.rating && p.rating.count > 0 && <p className="mt-0.5 text-xs text-muted-foreground"><Stars value={p.rating.average} /> {p.rating.average} ({p.rating.count})</p>}
        <div className="mt-1">
          {price.current.map((c, i) => (
            <div key={c.text} className="flex items-baseline gap-2">
              <span className="font-semibold text-primary">{c.text}</span>
              {price.original[i] && <span className="text-xs text-muted-foreground line-through">{price.original[i]!.text}</span>}
            </div>
          ))}
          {price.current.length === 0 && <span className="text-sm text-muted-foreground">Price on request</span>}
        </div>
        <button
          className="btn-secondary mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!purchasable}
          onClick={() => {
            const r = add(variantId);
            if (r.ok) toast(`${p.name} added to cart`); else toast.error(r.reason);
          }}
        >
          {purchasable ? cta : AVAILABILITY_LABEL[view.availability]}
        </button>
      </div>
    </article>
  );
}
