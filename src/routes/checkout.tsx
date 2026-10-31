import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { api, newIdempotencyKey } from "@/lib/api";
import type { ApiOrder, PayMethod } from "@/lib/api-client";
import { PayPanel } from "@/components/PayPanel";
import { useCart } from "@/lib/cart";
import { useCatalog } from "@/lib/catalog-store";
import { estimate } from "@/lib/storefront";
import { useCurrency } from "@/lib/currency";
import { formatMoney } from "@/lib/domain/money";
import { Errors, Field, inputCls, Notice, Page } from "@/components/Form";

export const Route = createFileRoute("/checkout")({
  head: () => ({ meta: [{ title: "Checkout — Dera Darko Trade" }, { name: "robots", content: "noindex" }] }),
  component: Checkout,
});

type Zone = { id: string; name: string; regions: string[]; currency: "GHS" | "USD"; baseFee: number; estimate: string };
type Placed = { order: ApiOrder; trackingSecret?: string; paymentAvailable: boolean; methods: PayMethod[] };

function Checkout() {
  const { lines, clear } = useCart();
  const { mode } = useCurrency();
  const currency = mode === "USD" ? "USD" : "GHS";
  const { products } = useCatalog();
  const q = estimate(lines, products, currency);
  const key = useRef(newIdempotencyKey());
  const [zones, setZones] = useState<Zone[] | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [zoneId, setZoneId] = useState(""); const [region, setRegion] = useState("");
  const [f, setF] = useState({ email: "", recipient: "", phone: "", city: "", street: "", code: "" });
  const [terms, setTerms] = useState(false); const [pre, setPre] = useState(false);
  const [errors, setErrors] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [placed, setPlaced] = useState<Placed | null>(null);

  const [saved, setSaved] = useState<{ id: string; recipient: string; region: string; city: string; street: string; isDefault: boolean }[]>([]);
  useEffect(() => { void api.zones().then((r) => setZones(r.ok ? r.data : [])); void api.me().then((r) => { setSignedIn(r.ok); if (r.ok) void api.addresses().then((a) => { if (a.ok) setSaved(a.data ?? []); }); }); }, []);
  const useSaved = (id: string) => {
    const a = saved.find((x) => x.id === id); if (!a) return;
    setF((v) => ({ ...v, recipient: a.recipient, city: a.city, street: a.street }));
    const z = zones?.find((zz) => zz.regions.includes(a.region)); if (z) { setZoneId(z.id); setRegion(a.region); }
  };
  const zone = zones?.find((z) => z.id === zoneId);
  const hasPre = q.ok && q.hasPreorder;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErrors([]);
    if (!zone) return setErrors(["Choose a delivery area."]);
    setBusy(true);
    const r = await api.checkout({
      lines, currency, region, zoneId, ...(signedIn ? {} : { guestEmail: f.email.trim() }),
      address: { recipient: f.recipient.trim(), region, city: f.city.trim(), street: f.street.trim(), ...(f.phone.trim() ? { phone: f.phone.trim() } : {}) },
      ...(f.code.trim() ? { discountCode: f.code.trim() } : {}), idempotencyKey: key.current, acceptedTerms: terms, preorderAcknowledged: pre,
    });
    setBusy(false);
    if (r.ok && r.data) { setPlaced({ order: r.data.order, paymentAvailable: r.data.paymentAvailable, methods: r.data.paymentMethods, ...(r.data.trackingSecret ? { trackingSecret: r.data.trackingSecret } : {}) }); clear(); } else setErrors(r.errors);
  }

  if (placed) {
    const o = placed.order;
    return (
      <Page title="Order received">
        <Notice>
          <p>Your order <strong>{o.ref}</strong> is reserved. Total: <strong>{formatMoney({ amount: o.total, currency: o.currency })}</strong>.</p>
          <p className="mt-2">{placed.paymentAvailable ? "Your items are reserved for a limited time. Complete payment to confirm your order." : "Online payment is not available yet, so the business will contact you to arrange payment. Reserved items are held for a limited time."}</p>
        </Notice>
        {placed.paymentAvailable && <PayPanel orderRef={o.ref} trackingSecret={placed.trackingSecret} total={o.total} currency={o.currency} payBy={o.payBy} methods={placed.methods} />}
        {placed.trackingSecret && (
          <div className="rounded-md border border-border p-4 text-sm">
            <p className="font-semibold">Save your tracking code — it is shown only once.</p>
            <code className="mt-2 block break-all rounded bg-secondary p-2">{placed.trackingSecret}</code>
            <Link to="/track" search={{ ref: o.ref }} className="mt-3 inline-block underline">Track this order</Link>
          </div>
        )}
        {signedIn && <Link to="/account" className="underline">View in your account</Link>}
      </Page>
    );
  }
  if (lines.length === 0) return <Page title="Checkout"><Notice>Your cart is empty. <Link to="/shop" search={{}} className="underline">Continue shopping</Link>.</Notice></Page>;

  return (
    <Page title="Checkout" narrow={false}>
      <form onSubmit={submit} className="grid gap-10 lg:grid-cols-[1fr_22rem]" noValidate>
        <div className="space-y-4">
          <Errors errors={errors} />
          {signedIn === false && <Field label="Email for order updates" type="email" autoComplete="email" required value={f.email} onChange={set("email")} />}
          <Field label="Recipient name" autoComplete="name" required value={f.recipient} onChange={set("recipient")} />
          <Field label="Phone (for the courier)" type="tel" autoComplete="tel" value={f.phone} onChange={set("phone")} />
          <div>
            <label htmlFor="zone" className="mb-1 block text-sm font-medium">Delivery area</label>
            <select id="zone" className={inputCls} required value={zoneId} onChange={(e) => { setZoneId(e.target.value); setRegion(""); }}>
              <option value="" disabled>{zones === null ? "Loading…" : zones.length ? "Choose…" : "No delivery areas are configured yet"}</option>
              {zones?.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
            {zone && <p className="mt-1 text-xs text-muted-foreground">Estimated delivery: {zone.estimate} (estimate, not a guarantee). Fee: {formatMoney({ amount: zone.baseFee, currency: zone.currency })}.</p>}
          </div>
          {zone && (
            <div>
              <label htmlFor="region" className="mb-1 block text-sm font-medium">Region</label>
              <select id="region" className={inputCls} required value={region} onChange={(e) => setRegion(e.target.value)}>
                <option value="" disabled>Choose…</option>{zone.regions.map((r) => <option key={r}>{r}</option>)}
              </select>
            </div>
          )}
          {saved.length > 0 && (
            <div className="sm:col-span-2">
              <label htmlFor="saved-address" className="mb-1 block text-sm font-medium">Use a saved address</label>
              <select id="saved-address" className={inputCls} defaultValue="" onChange={(e) => useSaved(e.target.value)}>
                <option value="">Enter a new address…</option>
                {saved.map((a) => <option key={a.id} value={a.id}>{a.recipient} — {a.street}, {a.city}{a.isDefault ? " (default)" : ""}</option>)}
              </select>
            </div>
          )}
          <Field label="Town / city" autoComplete="address-level2" required value={f.city} onChange={set("city")} />
          <Field label="Street address / landmark" autoComplete="street-address" required value={f.street} onChange={set("street")} />
          <Field label="Discount code (optional)" value={f.code} onChange={set("code")} />
          {hasPre && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={pre} onChange={(e) => setPre(e.target.checked)} /> I understand my pre-order items ship after the expected arrival window, which is an estimate.</label>}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={terms} onChange={(e) => setTerms(e.target.checked)} required /> I accept the <Link to="/policies/$slug" params={{ slug: "terms" }} className="underline">Terms</Link>, <Link to="/policies/$slug" params={{ slug: "returns" }} className="underline">Returns policy</Link> and <Link to="/policies/$slug" params={{ slug: "privacy" }} className="underline">Privacy Policy</Link>.</label>
        </div>
        <aside className="card-elevated h-fit p-6 text-sm">
          <h2 className="font-display text-lg font-bold">Summary ({currency})</h2>
          {q.ok ? (
            <dl className="mt-3 space-y-2">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatMoney(q.subtotal)}</dd></div>
              <div className="flex justify-between"><dt>Delivery</dt><dd>{zone ? formatMoney({ amount: zone.baseFee, currency: zone.currency }) : "Choose an area"}</dd></div>
            </dl>
          ) : <Errors errors={q.errors} />}
          <p className="mt-3 text-xs text-muted-foreground">The final total is calculated by our server when you place the order, using live prices and stock.</p>
          <button className="btn-primary mt-4 w-full" disabled={busy || !q.ok}>{busy ? "Placing order…" : "Place order"}</button>
        </aside>
      </form>
    </Page>
  );
}
