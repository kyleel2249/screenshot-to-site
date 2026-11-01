import { Link } from "@tanstack/react-router";
import { Check, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Errors, Field, inputCls } from "@/components/Form";
import { PayPanel } from "@/components/PayPanel";
import { ProductImage } from "@/components/ProductImage";
import { Empty, Heading, useDash } from "@/components/dashboard/shared";
import { orderBucket, PROGRESS_STEPS, progressIndex } from "@/lib/dashboard-lib";
import { GHANA_REGIONS } from "@/lib/domain/regions";
import { formatMoney, type Currency } from "@/lib/domain/money";
import { useGuest } from "@/lib/guest";
import { REQUEST_KIND_LABEL, REQUEST_KINDS, type OrderDetail, type RequestKind, type ReturnRequestView } from "@/lib/guest-types";
import { labelOf } from "@/lib/order-labels";

const money = (amount: number, currency: Currency) => formatMoney({ amount, currency });
/** Payment state derived from the order's real history — never assumed. */
export function paymentLabel(o: Pick<OrderDetail, "status" | "history">): string {
  if (o.status === "payment_under_review") return "Under review";
  if (o.status === "pending_payment") return "Awaiting payment";
  if (["refunded"].includes(o.status)) return "Refunded";
  if (["partially_refunded", "refund_pending"].includes(o.status)) return "Refund in progress";
  return o.history.some((h) => h.to === "payment_confirmed") ? "Paid" : "Not paid";
}

/** Animated progress for the normal path; unusual states (cancelled, returned, refunds) get a plain banner instead of a misleading bar. */
export function OrderProgress({ o }: { o: Pick<OrderDetail, "status" | "history"> }) {
  const idx = progressIndex(o.status);
  return (
    <div>
      {idx >= 0 ? (
        <ol className="my-3 grid grid-cols-5 gap-1" aria-label="Order progress">{PROGRESS_STEPS.map((s, i) => (
          <li key={s.id} className="text-center" aria-current={i === idx ? "step" : undefined}>
            <div className="relative mx-auto mb-1 grid h-7 w-7 place-items-center rounded-full border-2 text-[11px] font-bold transition-colors motion-reduce:transition-none" style={{ borderColor: i <= idx ? "var(--gold)" : "var(--border)", background: i < idx ? "var(--gold)" : "transparent", color: i < idx ? "var(--gold-foreground)" : "inherit" }}>
              {i < idx ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : i + 1}{i === idx && <span className="dash-ping absolute inset-0 rounded-full border-2 border-gold" aria-hidden="true" />}
            </div>
            <span className={`block text-[10px] leading-tight sm:text-xs ${i <= idx ? "font-medium text-primary" : "text-muted-foreground"}`}>{s.label}</span>
          </li>))}</ol>
      ) : <p className="my-3 rounded-lg bg-secondary p-2 text-sm font-medium text-primary" role="status">{labelOf(o.status)}</p>}
      <ol className="space-y-1 text-xs text-muted-foreground">{[...o.history].reverse().map((h) => <li key={`${h.to}${h.at}`}>{new Date(h.at).toLocaleString()} — <span className="text-foreground">{labelOf(h.to)}</span></li>)}</ol>
    </div>
  );
}

export function OrderCard({ o, onChanged }: { o: OrderDetail; onChanged?: () => void }) {
  const g = useGuest(); const { go, quickView } = useDash();
  const [code, setCode] = useState<string | null>(null); const [msg, setMsg] = useState("");
  const pay = async () => { const r = await g.call<{ trackingCode: string }>("POST", "/orders/reissue", { ref: o.ref }); if (r.ok && r.data) setCode(r.data.trackingCode); else setMsg(r.errors[0] ?? "We couldn't open payment for this order."); };
  return (
    <article className="dash-fade rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]" aria-label={`Order ${o.ref}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-display text-lg font-bold text-primary">{o.ref}</h3><span className="text-xs text-muted-foreground">{new Date(o.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })} · {o.currency}</span></header>
      <p className="mt-1 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-secondary px-2 py-0.5">Payment: <strong>{paymentLabel(o)}</strong></span><span className="rounded-full bg-secondary px-2 py-0.5">Fulfilment: <strong>{labelOf(o.status)}</strong></span></p>
      <ul className="mt-3 divide-y divide-border">{o.items.map((i) => (
        <li key={i.variantId} className="flex items-center gap-3 py-2">
          <button type="button" disabled={!i.slug} onClick={() => i.slug && quickView(i.slug)} className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-secondary"><ProductImage src={i.image} alt={i.name} className="h-full w-full object-contain" /></button>
          <div className="min-w-0 flex-1 text-sm"><p className="line-clamp-2">{i.name}{i.mode === "preorder" && <span className="ml-1 text-xs text-muted-foreground">(pre-order)</span>}</p><p className="text-xs text-muted-foreground">{i.qty} × {money(i.unit, o.currency)}</p></div>
          <span className="text-sm font-medium">{money(i.line, o.currency)}</span>
        </li>))}</ul>
      <dl className="mt-2 space-y-0.5 text-sm"><div className="flex justify-between"><dt>Subtotal</dt><dd>{money(o.subtotal, o.currency)}</dd></div>{o.discount > 0 && <div className="flex justify-between"><dt>Discount</dt><dd>−{money(o.discount, o.currency)}</dd></div>}<div className="flex justify-between"><dt>Delivery</dt><dd>{money(o.shipping, o.currency)}</dd></div><div className="flex justify-between font-semibold"><dt>Total ({o.currency})</dt><dd>{money(o.total, o.currency)}</dd></div></dl>
      <p className="mt-2 text-xs text-muted-foreground">Delivering to {o.destination.city}, {o.destination.region}.{o.shipment && <> {o.shipment.carrier && `Carrier: ${o.shipment.carrier}. `}{o.shipment.trackingRef && `Tracking reference: ${o.shipment.trackingRef}. `}{o.shipment.estimatedDelivery && `Estimated delivery: ${o.shipment.estimatedDelivery}.`}</>}</p>
      <OrderProgress o={o} />
      {o.payBy && !code && <div className="mt-3 flex flex-wrap items-center gap-2"><button className="btn-primary px-5 py-2 text-sm" onClick={() => void pay()}>Pay now</button><span className="text-xs text-muted-foreground">Items held until {new Date(o.payBy).toLocaleTimeString()}</span></div>}
      {msg && <p role="alert" className="mt-2 text-xs text-destructive">{msg}</p>}
      {code && o.payBy && <div className="mt-3 border-t border-border pt-3"><PayPanel orderRef={o.ref} trackingSecret={code} total={o.total} currency={o.currency} payBy={o.payBy} /></div>}
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {["pending_payment", "payment_confirmed", "processing", "preparing_dispatch"].includes(o.status) && <button className="rounded-full border border-border px-3 py-1.5 hover:bg-secondary" onClick={() => go("returns", { kind: "cancellation", order: o.ref })}>Cancel order</button>}
        {o.status === "delivered" && <button className="rounded-full border border-border px-3 py-1.5 hover:bg-secondary" onClick={() => go("returns", { kind: "return", order: o.ref })}>Return or report a problem</button>}
        {onChanged && <button className="rounded-full border border-border px-3 py-1.5 hover:bg-secondary" onClick={onChanged}>Refresh status</button>}
      </div>
    </article>
  );
}

export function Orders() {
  const g = useGuest(); const { go } = useDash(); const [orders, setOrders] = useState<OrderDetail[] | null>(null);
  const load = useCallback(async () => setOrders(await g.orders()), [g.orders]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load, g.state.orders.length]);
  const groups: [string, string][] = [["pending", "Pending payment"], ["active", "In progress"], ["completed", "Completed"], ["closed", "Cancelled / refunded"]];
  return (
    <section aria-label="My orders"><Heading title="My Orders" sub="Orders placed from this browser session. Placed an order elsewhere? Use Track My Order with your reference and tracking code." right={<button className="rounded-full border border-border px-4 py-2 text-sm hover:bg-secondary" onClick={() => go("track")}>Track another order</button>} />
      {orders === null ? <div className="dash-skeleton h-40 rounded-2xl" aria-busy="true" /> : orders.length === 0 ? <Empty title="No orders yet" action={<button className="btn-primary" onClick={() => go("shop")}>Start shopping</button>}>Orders you place here will appear with live status.</Empty> : (
        <div className="space-y-8">{groups.map(([b, title]) => { const list = orders.filter((o) => orderBucket(o.status) === b); return list.length ? <div key={b}><h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title} ({list.length})</h3><div className="space-y-4">{list.map((o) => <OrderCard key={o.ref} o={o} onChanged={() => void load()} />)}</div></div> : null; })}</div>)}
    </section>
  );
}

export function Track({ initialRef }: { initialRef?: string }) {
  const g = useGuest(); const [ref, setRef] = useState(initialRef ?? ""); const [secret, setSecret] = useState(""); const [o, setO] = useState<OrderDetail | null>(null);
  const [errors, setErrors] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [saved, setSaved] = useState(false);
  const go = async (e: FormEvent) => {
    e.preventDefault(); setErrors([]); setO(null); setSaved(false);
    if (!ref.trim() || !secret.trim()) return setErrors(["Enter your order reference and tracking code."]);
    setBusy(true); const r = await g.call<OrderDetail>("GET", `/track?ref=${encodeURIComponent(ref.trim())}&secret=${encodeURIComponent(secret.trim())}`); setBusy(false);
    if (r.ok && r.data) setO(r.data); else setErrors(r.status === 404 ? ["We couldn't find an order with those details. Check the reference and code and try again."] : r.errors);
  };
  const save = async () => { const r = await g.call("POST", "/orders/claim", { ref: ref.trim(), secret: secret.trim() }); if (r.ok) { setSaved(true); toast("Saved to My Orders"); } else toast.error(r.errors[0] ?? "Couldn't save"); };
  const own = o ? g.state.orders.some((x) => x.ref === o.ref) : false;
  return (
    <section aria-label="Track my order"><Heading title="Track My Order" sub="No login. Your order reference plus the tracking code shown when you ordered keeps your order private." />
      <form onSubmit={(e) => void go(e)} className="max-w-md space-y-3" noValidate><Errors errors={errors} />
        <Field label="Order reference" placeholder="DDT-XXXXXX" required autoComplete="off" value={ref} onChange={(e) => setRef(e.target.value)} /><Field label="Tracking code" required autoComplete="off" hint="Shown once when you placed the order." value={secret} onChange={(e) => setSecret(e.target.value)} />
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Looking…" : "Track order"}</button></form>
      {o && <div className="mt-6 max-w-2xl space-y-3"><OrderCard o={o} />{!own && !saved && <button className="rounded-full border border-border px-4 py-2 text-sm hover:bg-secondary" onClick={() => void save()}>Save to My Orders in this session</button>}</div>}
    </section>
  );
}

/* ---------------- returns & refunds ---------------- */
const REASONS = ["Item arrived damaged", "Wrong item received", "Item doesn't match the description", "Doesn't fit / not the right size", "Changed my mind", "Delivery took too long", "Other"];
export function Returns({ presetKind, presetOrder }: { presetKind?: string; presetOrder?: string }) {
  const g = useGuest(); const [orders, setOrders] = useState<OrderDetail[]>([]); const [list, setList] = useState<ReturnRequestView[]>([]);
  const kind0 = (REQUEST_KINDS as readonly string[]).includes(presetKind ?? "") ? (presetKind as RequestKind) : "return";
  const [f, setF] = useState({ kind: kind0, order: presetOrder ?? "", code: "", variantId: "", reason: "", other: "", description: "" });
  const [errors, setErrors] = useState<string[]>([]); const [done, setDone] = useState(""); const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => { setOrders(await g.orders()); setList(await g.returns()); }, [g.orders, g.returns]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void refresh(); }, [refresh]);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const mine = orders.find((o) => o.ref === f.order); const external = f.order === "__other";
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErrors([]); setDone(""); setBusy(true);
    const body = { kind: f.kind, orderRef: external ? ((document.getElementById("rt-ref") as HTMLInputElement | null)?.value ?? "") : f.order, ...(external ? { trackingCode: f.code } : {}), ...(f.variantId ? { variantId: f.variantId } : {}), reason: f.reason === "Other" ? f.other : f.reason, description: f.description };
    const r = await g.call<{ ref: string; outcome: string }>("POST", "/returns", body); setBusy(false);
    if (!r.ok || !r.data) return setErrors(r.errors);
    setDone(r.data.outcome === "cancelled" ? `Your order was cancelled and the items released. Reference ${r.data.ref}.` : r.data.outcome === "requested" ? `Your cancellation request is with our team. Reference ${r.data.ref}.` : `Request ${r.data.ref} received. Our team will review it and reply by email.`);
    setF((x) => ({ ...x, description: "", reason: "", other: "", variantId: "" })); void refresh();
  };
  return (
    <section aria-label="Returns and refunds"><Heading title="My Returns & Refunds" sub={<>Requests are reviewed by our team under our <Link to="/policies/$slug" params={{ slug: "returns" }} className="underline">returns policy</Link>. Sending a request does not guarantee a refund or cancellation.</>} />
      <form onSubmit={(e) => void submit(e)} className="max-w-2xl space-y-3 rounded-2xl border border-border bg-card p-4" noValidate>
        <Errors errors={errors} />{done && <p role="status" className="rounded-md border border-gold bg-gold/10 p-3 text-sm">{done}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="mb-1 block text-sm font-medium" htmlFor="rt-kind">What would you like to do?</label><select id="rt-kind" className={inputCls} value={f.kind} onChange={(e) => set("kind", e.target.value)}>{REQUEST_KINDS.map((k) => <option key={k} value={k}>{REQUEST_KIND_LABEL[k]}</option>)}</select></div>
          <div><label className="mb-1 block text-sm font-medium" htmlFor="rt-order">Order</label><select id="rt-order" className={inputCls} value={f.order} onChange={(e) => set("order", e.target.value)}><option value="">Choose an order…</option>{g.state.orders.map((o) => <option key={o.ref} value={o.ref}>{o.ref} — {labelOf(o.status)}</option>)}<option value="__other">Another order (reference + tracking code)…</option></select></div>
          {external && <><div><label className="mb-1 block text-sm font-medium" htmlFor="rt-ref">Order reference</label><input id="rt-ref" className={inputCls} autoComplete="off" /></div><Field label="Tracking code" autoComplete="off" value={f.code} onChange={(e) => set("code", e.target.value)} /></>}
          {mine && f.kind !== "cancellation" && mine.items.length > 0 && <div><label className="mb-1 block text-sm font-medium" htmlFor="rt-prod">Product</label><select id="rt-prod" className={inputCls} value={f.variantId} onChange={(e) => set("variantId", e.target.value)}><option value="">Whole order</option>{mine.items.map((i) => <option key={i.variantId} value={i.variantId}>{i.name}</option>)}</select></div>}
          <div><label className="mb-1 block text-sm font-medium" htmlFor="rt-reason">Reason</label><select id="rt-reason" className={inputCls} value={f.reason} onChange={(e) => set("reason", e.target.value)}><option value="">Choose…</option>{REASONS.map((r) => <option key={r}>{r}</option>)}</select></div>
          {f.reason === "Other" && <Field label="Your reason" maxLength={200} value={f.other} onChange={(e) => set("other", e.target.value)} />}
        </div>
        <div><label className="mb-1 block text-sm font-medium" htmlFor="rt-desc">Tell us what happened{f.kind === "cancellation" ? " (optional)" : ""}</label><textarea id="rt-desc" className={`${inputCls} min-h-28`} maxLength={2000} value={f.description} onChange={(e) => set("description", e.target.value)} /></div>
        <p className="text-xs text-muted-foreground">Photos: we can't take uploads here yet. After you send this, reply to our email with photos of any damage or error and quote your request reference.</p>
        <button className="btn-primary" disabled={busy}>{busy ? "Sending…" : f.kind === "cancellation" ? "Cancel / request cancellation" : "Send request"}</button>
      </form>
      <h3 className="mb-2 mt-8 font-display text-lg font-bold text-primary">My requests</h3>
      {list.length === 0 ? <p className="text-sm text-muted-foreground">No requests yet.</p> : <ul className="space-y-3">{list.map((r) => (
        <li key={r.ref} className="dash-fade rounded-2xl border border-border bg-card p-4 text-sm"><div className="flex flex-wrap items-baseline justify-between gap-2"><strong className="text-primary">{r.ref}</strong><span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{r.status}</span></div>
          <p className="mt-1">{REQUEST_KIND_LABEL[r.kind]} · order {r.orderRef} ({r.orderStatus}){r.productName ? ` · ${r.productName}` : ""}</p><p className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()} · {r.reason}</p>
          {r.replies.map((m, i) => <p key={i} className={`mt-2 rounded-lg p-2 text-xs ${m.fromStaff ? "bg-gold/15" : "bg-secondary"}`}><strong>{m.fromStaff ? "Dera Darko Trade" : "You"}:</strong> {m.body}</p>)}</li>))}</ul>}
    </section>
  );
}

/* ---------------- saved addresses ---------------- */
export function Addresses() {
  const g = useGuest(); const [f, setF] = useState({ label: "", recipient: "", region: "", city: "", street: "", phone: "" }); const [errors, setErrors] = useState<string[]>([]);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const add = async (e: FormEvent) => { e.preventDefault(); setErrors([]); const r = await g.call("POST", "/addresses", f); if (r.ok) { setF({ label: "", recipient: "", region: "", city: "", street: "", phone: "" }); toast("Address saved"); } else setErrors(r.errors); };
  return (
    <section aria-label="Saved addresses"><Heading title="Saved Addresses" sub="Kept with this browser session for faster checkout. Up to five." />
      <div className="grid gap-5 lg:grid-cols-2">
        <div>{g.state.addresses.length === 0 ? <Empty title="No saved addresses">Add one so checkout can fill it in for you.</Empty> : <ul className="space-y-3">{g.state.addresses.map((a) => (
          <li key={a.id} className="dash-fade flex items-start justify-between gap-3 rounded-2xl border border-border bg-card p-4 text-sm"><div><p className="font-semibold text-primary">{a.label}</p><p>{a.recipient}</p><p className="text-muted-foreground">{a.street}, {a.city}, {a.region}</p>{a.phone && <p className="text-muted-foreground">{a.phone}</p>}</div>
            <button className="inline-flex items-center gap-1 text-xs text-primary underline" aria-label={`Delete address ${a.label}`} onClick={() => void g.call("DELETE", "/addresses", { id: a.id })}><X className="h-3.5 w-3.5" aria-hidden="true" />Delete</button></li>))}</ul>}</div>
        <form onSubmit={(e) => void add(e)} className="space-y-3 rounded-2xl border border-border bg-card p-4" noValidate aria-label="Add an address"><Errors errors={errors} />
          <Field label="Label" placeholder="Home, Office…" maxLength={30} value={f.label} onChange={(e) => set("label", e.target.value)} /><Field label="Recipient name" required autoComplete="name" value={f.recipient} onChange={(e) => set("recipient", e.target.value)} />
          <div><label className="mb-1 block text-sm font-medium" htmlFor="ad-region">Region</label><select id="ad-region" className={inputCls} value={f.region} onChange={(e) => set("region", e.target.value)}><option value="">Choose…</option>{GHANA_REGIONS.map((r) => <option key={r}>{r}</option>)}</select></div>
          <Field label="City / town" required value={f.city} onChange={(e) => set("city", e.target.value)} /><Field label="Street address" required value={f.street} onChange={(e) => set("street", e.target.value)} /><Field label="Phone (optional)" type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
          <button className="btn-secondary w-full">Save address</button></form></div>
    </section>
  );
}
