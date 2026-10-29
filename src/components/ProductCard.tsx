import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { formatGHS, type Product } from "@/lib/catalog";
import { useCart } from "@/lib/cart";

export function ProductCard({ p }: { p: Product }) {
  const { add } = useCart();
  return (
    <article className="group card-elevated overflow-hidden flex flex-col">
      <Link to="/product/$slug" params={{ slug: p.slug }} className="relative block aspect-square overflow-hidden bg-muted">
        <img src={p.image} alt={p.name} loading="lazy" width={816} height={816} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
        {p.availability === "preorder" && <span className="badge-preorder absolute left-3 top-3">Preorder</span>}
      </Link>
      <div className="flex flex-1 flex-col p-4">
        <Link to="/product/$slug" params={{ slug: p.slug }} className="font-medium text-foreground hover:underline">{p.name}</Link>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-semibold text-primary">{formatGHS(p.price)}</span>
          {p.compareAt && <span className="text-xs text-muted-foreground line-through">{formatGHS(p.compareAt)}</span>}
        </div>
        <button
          className="btn-secondary mt-4"
          onClick={() => { add(p.slug); toast.success(`${p.name} added to cart`); }}
        >
          {p.availability === "preorder" ? "Preorder" : "Add to cart"}
        </button>
      </div>
    </article>
  );
}
