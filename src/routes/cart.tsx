import { createFileRoute, Link } from "@tanstack/react-router";
import { Minus, Plus, Trash2 } from "lucide-react";
import { formatGHS, getProduct } from "@/lib/catalog";
import { useCart } from "@/lib/cart";

export const Route = createFileRoute("/cart")({
  head: () => ({
    meta: [
      { title: "Your cart — Dera Darko Trade" },
      { name: "description", content: "Review the items in your Dera Darko Trade cart." },
      { property: "og:title", content: "Your cart — Dera Darko Trade" },
      { property: "og:description", content: "Review your cart." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Cart,
});

function Cart() {
  const { lines, setQty, remove, total } = useCart();
  if (lines.length === 0)
    return (
      <div className="container-x py-20 text-center">
        <h1 className="font-display text-3xl font-bold">Your cart is empty</h1>
        <Link to="/shop" className="btn-primary mt-6">Start shopping</Link>
      </div>
    );
  return (
    <div className="container-x grid gap-10 py-12 lg:grid-cols-[1fr_22rem]">
      <div>
        <h1 className="font-display text-4xl font-bold">Your cart</h1>
        <ul className="mt-6 divide-y divide-border">
          {lines.map((l) => {
            const p = getProduct(l.slug);
            if (!p) return null;
            return (
              <li key={l.slug} className="flex gap-4 py-5">
                <img src={p.image} alt="" width={96} height={96} className="h-24 w-24 rounded-lg object-cover" />
                <div className="flex-1">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-sm text-muted-foreground">{formatGHS(p.price)}{p.availability === "preorder" && ` · Preorder (${p.leadTime})`}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <button className="rounded-full border border-border p-1.5" onClick={() => setQty(l.slug, l.qty - 1)} aria-label="Decrease"><Minus className="h-3 w-3" /></button>
                    <span className="w-6 text-center text-sm">{l.qty}</span>
                    <button className="rounded-full border border-border p-1.5" onClick={() => setQty(l.slug, l.qty + 1)} aria-label="Increase"><Plus className="h-3 w-3" /></button>
                    <button className="ml-3 text-muted-foreground hover:text-destructive" onClick={() => remove(l.slug)} aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
                <p className="font-semibold text-primary">{formatGHS(p.price * l.qty)}</p>
              </li>
            );
          })}
        </ul>
      </div>
      <aside className="card-elevated h-fit p-6">
        <div className="flex justify-between font-semibold"><span>Subtotal</span><span className="text-primary">{formatGHS(total)}</span></div>
        <p className="mt-2 text-xs text-muted-foreground">Delivery is calculated at checkout.</p>
        <button className="btn-primary mt-6 w-full" disabled title="Online payment not yet connected">Checkout (coming soon)</button>
        <Link to="/contact" className="mt-3 block text-center text-sm text-primary hover:underline">Order by contacting us</Link>
      </aside>
    </div>
  );
}
