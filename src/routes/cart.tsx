import { createFileRoute, Link } from "@tanstack/react-router";
import { Minus, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { products } from "@/lib/catalog";
import { quote, useCart } from "@/lib/cart";
import { useCurrency } from "@/lib/currency";
import { formatMoney } from "@/lib/domain/money";

export const Route = createFileRoute("/cart")({
  head: () => ({
    meta: [
      { title: "Your cart — Dera Darko Trade" },
      { name: "description", content: "Review the items in your Dera Darko Trade cart." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Cart,
});

function Cart() {
  const { lines, setQty, remove } = useCart();
  const { mode, setMode } = useCurrency();
  // Cart pays in a single currency; DUAL display falls back to GHS for the charge.
  const currency = mode === "USD" ? "USD" : "GHS";
  const result = quote(lines, currency);

  if (lines.length === 0)
    return (
      <div className="container-x py-20 text-center">
        <h1 className="font-display text-3xl font-bold">Your cart is empty</h1>
        <Link to="/shop" search={{}} className="btn-primary mt-6">Start shopping</Link>
      </div>
    );

  const byVariant = new Map(products.flatMap((p) => p.variants.map((v) => [v.id, p] as const)));
  return (
    <div className="container-x grid gap-10 py-12 lg:grid-cols-[1fr_22rem]">
      <div>
        <h1 className="font-display text-4xl font-bold">Your cart</h1>
        {!result.ok && (
          <div role="alert" className="mt-4 rounded-md border border-destructive/40 bg-secondary p-4 text-sm">
            <p className="font-semibold text-primary">Some items need your attention:</p>
            <ul className="mt-1 list-disc pl-5">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        )}
        <ul className="mt-6 divide-y divide-border">
          {lines.map((l) => {
            const p = byVariant.get(l.variantId);
            if (!p) return null;
            const priced = result.ok ? result.cart.lines.find((x) => x.variantId === l.variantId) : undefined;
            return (
              <li key={l.variantId} className="flex gap-4 py-5">
                <img src={p.image} alt={p.imageAlt} width={96} height={96} className="h-24 w-24 rounded-lg object-cover" />
                <div className="flex-1">
                  <Link to="/product/$slug" params={{ slug: p.slug }} className="font-medium hover:underline">{p.name}</Link>
                  {priced?.mode === "preorder" && <p className="text-sm text-muted-foreground">Pre-order · expected arrival {p.expectedWindow ?? "to be confirmed"} (estimate)</p>}
                  <div className="mt-3 flex items-center gap-2">
                    <button className="rounded-full border border-border p-1.5" onClick={() => { const r = setQty(l.variantId, l.qty - 1); if (!r.ok) toast.error(r.reason); }} aria-label={`Decrease quantity of ${p.name}`}><Minus className="h-3 w-3" /></button>
                    <span className="w-6 text-center text-sm" aria-live="polite">{l.qty}</span>
                    <button className="rounded-full border border-border p-1.5" onClick={() => { const r = setQty(l.variantId, l.qty + 1); if (!r.ok) toast.error(r.reason); }} aria-label={`Increase quantity of ${p.name}`}><Plus className="h-3 w-3" /></button>
                    <button className="ml-3 text-muted-foreground hover:text-destructive" onClick={() => remove(l.variantId)} aria-label={`Remove ${p.name}`}><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
                {priced && <p className="font-semibold text-primary">{formatMoney(priced.line)}</p>}
              </li>
            );
          })}
        </ul>
      </div>
      <aside className="card-elevated h-fit p-6">
        <label className="block text-sm">Currency
          <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2" value={currency} onChange={(e) => setMode(e.target.value as "GHS" | "USD")}>
            <option value="GHS">Ghana Cedi (GHS)</option><option value="USD">US Dollar (USD)</option>
          </select>
        </label>
        {result.ok && (
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatMoney(result.cart.subtotal)}</dd></div>
            {result.cart.discount.amount > 0 && <div className="flex justify-between"><dt>Discount</dt><dd>-{formatMoney(result.cart.discount)}</dd></div>}
            <div className="flex justify-between font-semibold"><dt>Total before delivery</dt><dd className="text-primary">{formatMoney(result.cart.total)}</dd></div>
          </dl>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Delivery and taxes are confirmed at checkout. Prices are re-checked against live stock.</p>
        <button className="btn-primary mt-6 w-full opacity-60" disabled title="Checkout requires a configured payment provider and database">Checkout unavailable until payments are connected</button>
        <Link to="/contact" className="mt-3 block text-center text-sm text-primary hover:underline">Order by contacting us</Link>
      </aside>
    </div>
  );
}
