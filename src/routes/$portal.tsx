import { createFileRoute, notFound } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { AdminDiscount, AdminOrder, AdminProduct, AdminZone, Analytics, StaffMember, Ticket } from "@/lib/api-client";
import { childrenOf, topLevel, type CategoryNode } from "@/lib/domain/categories";
import { formatMoney } from "@/lib/domain/money";
import { GHANA_REGIONS } from "@/lib/domain/regions";
import { AVAILABILITY_LABEL, type Availability } from "@/lib/domain/status";
import { labelOf, nextStatuses } from "@/lib/order-labels";
import { Errors, Field, inputCls, Notice } from "@/components/Form";

/**
 * Staff dashboard. Mounted on a secret, owner-configured path segment (never "admin"). The segment is a URL parameter, not
 * compiled into any bundle: the page asks the server, which answers 404 unless the segment matches ADMIN_PORTAL_PATH.
 * Static routes win over this dynamic one, so public pages are unaffected. All authorisation is enforced server-side.
 */
export const Route = createFileRoute("/$portal")({
  head: () => ({ meta: [{ title: "Dashboard" }, { name: "robots", content: "noindex,nofollow,noarchive" }, { name: "referrer", content: "no-referrer" }] }),
  beforeLoad: ({ params }) => { if (!/^[a-z0-9-]{12,}$/i.test(params.portal) || /admin/i.test(params.portal)) throw notFound(); },
  component: Dashboard,
});

type Tab = "staff" | "products" | "orders" | "support" | "analytics" | "categories" | "shipping" | "discounts" | "audit";
const AVAIL = Object.keys(AVAILABILITY_LABEL) as Availability[];

function Dashboard() {
  const { portal } = Route.useParams();
  const admin = useMemo(() => api.admin(`/${portal}`), [portal]);
  const [state, setState] = useState<"checking" | "enrol" | "login" | "in" | "missing">("checking");
  const [roles, setRoles] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>("products");

  const check = useCallback(async () => { const r = await admin.me(); if (r.ok && r.data) { setRoles(r.data.roles); setState("in"); } else setState(r.status === 401 || r.status === 404 ? "login" : "missing"); }, [admin]);
  useEffect(() => { void check(); }, [check]);

  if (state === "checking") return <div className="container-x py-16"><Notice>Loading…</Notice></div>;
  if (state === "missing") return <div className="container-x py-16"><Notice>Page not found.</Notice></div>;
  if (state === "login" || state === "enrol") return <Gate admin={admin} mode={state} setMode={setState} onDone={check} />;

  return (
    <div className="container-x py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold">Dashboard <span className="badge-label ml-2">{roles.join(", ")}</span></h1>
        <button className="rounded-full border border-border px-4 py-2 text-sm" onClick={() => void api.logout().then(() => setState("login"))}>Sign out</button>
      </header>
      <nav className="mt-6 flex gap-2" aria-label="Sections" role="tablist">
        {(["products", "orders", "support", "staff", "analytics", "categories", "shipping", "discounts", "audit"] as Tab[]).map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-full px-4 py-2 text-sm font-medium capitalize ${tab === t ? "bg-primary text-primary-foreground" : "border border-border"}`}>{t}</button>)}
      </nav>
      <div className="mt-6">{tab === "products" ? <Products admin={admin} /> : tab === "orders" ? <Orders admin={admin} /> : tab === "staff" ? <StaffTab admin={admin} /> : tab === "support" ? <Support admin={admin} /> : tab === "analytics" ? <AnalyticsView admin={admin} /> : tab === "categories" ? <Categories admin={admin} /> : tab === "shipping" ? <Shipping admin={admin} /> : tab === "discounts" ? <Discounts admin={admin} /> : <Audit admin={admin} />}</div>
    </div>
  );
}
type Admin = ReturnType<typeof api.admin>;

function Gate({ admin, mode, setMode, onDone }: { admin: Admin; mode: "login" | "enrol"; setMode: (m: "login" | "enrol") => void; onDone: () => void }) {
  const [f, setF] = useState({ email: "", password: "", reference: "" }); const [errors, setErrors] = useState<string[]>([]); const [note, setNote] = useState("");
  async function go(e: React.FormEvent) {
    e.preventDefault(); setErrors([]); setNote("");
    if (mode === "login") { const r = await api.login(f.email.trim(), f.password); if (r.ok) { setF({ ...f, password: "" }); onDone(); } else setErrors(r.errors); return; }
    const r = await admin.enrol({ reference: f.reference, email: f.email.trim(), password: f.password });
    if (r.ok) { setF({ email: f.email, password: "", reference: "" }); setNote("Owner account created. Verify the email we sent, then sign in."); setMode("login"); } else setErrors(["Enrolment is unavailable or the details were rejected."]);
  }
  return (
    <div className="container-x max-w-md py-16">
      <h1 className="font-display text-2xl font-bold">{mode === "login" ? "Staff sign in" : "Owner enrolment"}</h1>
      <form onSubmit={go} className="mt-6 space-y-4" noValidate>
        <Errors errors={errors} />{note && <Notice>{note}</Notice>}
        <Field label="Email" type="email" autoComplete="username" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <Field label="Password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        {mode === "enrol" && <Field label="Enrolment reference" type="password" autoComplete="off" required value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />}
        <button className="btn-primary w-full">{mode === "login" ? "Sign in" : "Create owner account"}</button>
      </form>
      <button className="mt-4 text-sm underline" onClick={() => setMode(mode === "login" ? "enrol" : "login")}>{mode === "login" ? "First-time owner setup" : "Back to sign in"}</button>
    </div>
  );
}

function useLoad<T>(fn: () => Promise<{ ok: boolean; data: T | null; errors: string[] }>) {
  const [data, setData] = useState<T | null>(null); const [errors, setErrors] = useState<string[]>([]);
  const reload = useCallback(async () => { const r = await fn(); if (r.ok) { setData(r.data); setErrors([]); } else setErrors(r.errors); }, [fn]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, errors, reload, setErrors };
}

function Products({ admin }: { admin: Admin }) {
  const { data, errors, reload, setErrors } = useLoad<AdminProduct[]>(useCallback(() => admin.products(), [admin]));
  const [msg, setMsg] = useState("");
  const cats = useLoad<CategoryNode[]>(useCallback(() => admin.categories(), [admin]));
  const categories = cats.data ?? [];
  const act = async (fn: () => Promise<{ ok: boolean; errors: string[] }>, ok: string) => { setMsg(""); const r = await fn(); if (r.ok) { setMsg(ok); await reload(); } else setErrors(r.errors); };
  const [nw, setNw] = useState({ name: "", sku: "", categoryId: "", shortDescription: "", image: "", imageAlt: "", priceGhs: "", onHand: "0" });
  return (
    <div className="space-y-6">
      <Errors errors={errors} />{msg && <Notice>{msg}</Notice>}
      <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <caption className="sr-only">Products</caption>
        <thead><tr className="border-b border-border"><th className="p-2">Product</th><th className="p-2">Status</th><th className="p-2">Price (GHS)</th><th className="p-2">Stock</th><th className="p-2">Actions</th></tr></thead>
        <tbody>{data?.filter((p) => !p.archived).map((p) => (
          <tr key={p.id} className="border-b border-border align-top">
            <td className="p-2"><p className="font-medium">{p.name}</p><p className="text-xs text-muted-foreground">{p.sku}</p></td>
            <td className="p-2"><select aria-label={`Status of ${p.name}`} className={inputCls} value={p.availability ?? ""} onChange={(e) => void act(() => admin.setStatus([p.id], e.target.value as Availability), "Status updated.")}>{AVAIL.map((a) => <option key={a} value={a}>{AVAILABILITY_LABEL[a]}</option>)}</select></td>
            <td className="p-2"><PriceEdit p={p} onSave={(ghs) => act(() => admin.setPrices(p.variantId ?? "", { ghs }), "Price updated.")} /></td>
            <td className="p-2">{p.onHand} <span className="text-xs text-muted-foreground">({p.reserved} reserved)</span><StockEdit onSave={(d, r) => act(() => admin.adjustStock(p.variantId ?? "", d, r), "Stock adjusted.")} /></td>
            <td className="p-2"><button className="underline" onClick={() => void act(() => admin.publish(p.id, !p.published), p.published ? "Unpublished." : "Published.")}>{p.published ? "Unpublish" : "Publish"}</button></td>
          </tr>))}</tbody></table>{data && !data.length && <p className="p-3 text-muted-foreground">No products yet. Add the first one below.</p>}</div>
      <form className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void act(() => admin.createProduct({ ...nw, priceGhs: Math.round(Number(nw.priceGhs) * 100), onHand: Number(nw.onHand), published: false }), "Product created as unpublished.").then(() => setNw({ ...nw, name: "", sku: "" })); }}>
        <h2 className="font-display text-lg font-bold sm:col-span-2">Add product</h2>
        <Field label="Name" required value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} />
        <Field label="SKU" required value={nw.sku} onChange={(e) => setNw({ ...nw, sku: e.target.value })} />
        <div>
          <label htmlFor="np-cat" className="mb-1 block text-sm font-medium">Category</label>
          <select id="np-cat" required className={inputCls} value={nw.categoryId} onChange={(e) => setNw({ ...nw, categoryId: e.target.value })}>
            <option value="" disabled>Choose…</option>
            {topLevel(categories).map((g) => <optgroup key={g.id} label={g.name}>{[g, ...childrenOf(categories, g.id)].map((c) => <option key={c.id} value={c.id}>{c.id === g.id ? `${g.name} (general)` : c.name}</option>)}</optgroup>)}
          </select>
        </div>
        <Field label="Price (GHS)" type="number" step="0.01" min="0" required value={nw.priceGhs} onChange={(e) => setNw({ ...nw, priceGhs: e.target.value })} />
        <Field label="Opening stock" type="number" min="0" value={nw.onHand} onChange={(e) => setNw({ ...nw, onHand: e.target.value })} />
        <Field label="Short description" required value={nw.shortDescription} onChange={(e) => setNw({ ...nw, shortDescription: e.target.value })} />
        <Field label="Image URL" required value={nw.image} onChange={(e) => setNw({ ...nw, image: e.target.value })} />
        <Field label="Image description (alt text)" required value={nw.imageAlt} onChange={(e) => setNw({ ...nw, imageAlt: e.target.value })} />
        <button className="btn-primary sm:col-span-2">Create product</button>
      </form>
    </div>
  );
}
function PriceEdit({ p, onSave }: { p: AdminProduct; onSave: (ghs: number) => void }) {
  const [v, setV] = useState(((p.price.GHS ?? 0) / 100).toFixed(2));
  return <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); onSave(Math.round(Number(v) * 100)); }}><input aria-label={`GHS price of ${p.name}`} className={`${inputCls} w-24`} type="number" step="0.01" min="0" value={v} onChange={(e) => setV(e.target.value)} /><button className="underline">Save</button></form>;
}
function StockEdit({ onSave }: { onSave: (delta: number, reason: string) => void }) {
  const [d, setD] = useState(""); const [r, setR] = useState("");
  return <form className="mt-2 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (Number(d)) { onSave(Number(d), r); setD(""); setR(""); } }}><input aria-label="Stock change (+/-)" placeholder="±qty" className={`${inputCls} w-20`} type="number" value={d} onChange={(e) => setD(e.target.value)} /><input aria-label="Reason" placeholder="Reason" required className={`${inputCls} w-32`} value={r} onChange={(e) => setR(e.target.value)} /><button className="underline">Adjust</button></form>;
}

function Orders({ admin }: { admin: Admin }) {
  const { data, errors, reload, setErrors } = useLoad<AdminOrder[]>(useCallback(() => admin.orders(), [admin]));
  const [msg, setMsg] = useState(""); const [pw, setPw] = useState(""); const [need, setNeed] = useState(false);
  const act = async (fn: () => Promise<{ ok: boolean; errors: string[] }>, ok: string) => { setMsg(""); setErrors([]); const r = await fn(); if (r.ok) { setMsg(ok); await reload(); } else { setNeed(r.errors.some((e) => /re-?auth/i.test(e))); setErrors(r.errors); } };
  return (
    <div className="space-y-4">
      <Errors errors={errors} />{msg && <Notice>{msg}</Notice>}
      {need && <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void admin.reauth(pw).then((r) => { if (r.ok) { setNeed(false); setPw(""); setErrors([]); setMsg("Re-authenticated. Retry the action."); } else setErrors(r.errors); }); }}><input aria-label="Confirm your password" type="password" autoComplete="current-password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} /><button className="btn-primary">Confirm</button></form>}
      <button className="rounded-full border border-border px-4 py-2 text-sm" onClick={() => void act(async () => {
        const r = await admin.exportOrdersCsv();
        if (r.ok && r.data) { const url = URL.createObjectURL(new Blob([r.data], { type: "text/csv" })); const a = document.createElement("a"); a.href = url; a.download = "orders.csv"; a.click(); URL.revokeObjectURL(url); }
        return r;
      }, "Orders exported.")}>Export orders (CSV)</button>
      <ul className="divide-y divide-border">{data?.map((o) => (
        <li key={o.id} className="space-y-2 py-4 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><p className="font-semibold">{o.ref} · {labelOf(o.status)}</p><p>{formatMoney({ amount: o.total, currency: o.currency })}</p></div>
          <p className="text-muted-foreground">{o.address.recipient}, {o.address.street}, {o.address.city}, {o.address.region} · {o.guestEmail ?? "registered customer"}</p>
          <p>{o.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}</p>
          <div className="flex flex-wrap gap-2">
            {nextStatuses(o.status).map((s) => s === "refund_pending"
              ? <button key={s} className="rounded-full border border-border px-3 py-1" onClick={() => void act(() => admin.refund(o.id, o.total), "Refund requested.")}>Refund in full</button>
              : <button key={s} className="rounded-full border border-border px-3 py-1" onClick={() => void act(() => admin.setOrderStatus(o.id, s), `Moved to ${labelOf(s)}.`)}>{labelOf(s)}</button>)}
          </div>
        </li>))}{data && !data.length && <li className="py-4 text-muted-foreground">No orders yet.</li>}</ul>
    </div>
  );
}

function Audit({ admin }: { admin: Admin }) {
  const { data, errors } = useLoad(useCallback(() => admin.audit(), [admin]));
  return <div><Errors errors={errors} /><ol className="space-y-1 font-mono text-xs">{data?.map((e) => <li key={e.id}>{new Date(e.at).toISOString()} · {e.event}{e.actor ? ` · ${e.actor}` : ""}</li>)}</ol></div>;
}

const minor = (v: string) => Math.round(Number(v) * 100);
const major = (n: number | undefined) => (n === undefined ? "" : (n / 100).toFixed(2));

function Shipping({ admin }: { admin: Admin }) {
  const { data, errors, reload, setErrors } = useLoad<AdminZone[]>(useCallback(() => admin.zones(), [admin]));
  const blank = { id: "", name: "", currency: "GHS" as "GHS" | "USD", baseFee: "", perKgFee: "0", freeOver: "", estimate: "", quotationOnly: false, regions: [] as string[] };
  const [f, setF] = useState(blank); const [msg, setMsg] = useState("");
  const toggle = (r: string) => setF({ ...f, regions: f.regions.includes(r) ? f.regions.filter((x) => x !== r) : [...f.regions, r] });
  async function save(e: React.FormEvent) {
    e.preventDefault(); setMsg(""); setErrors([]);
    const r = await admin.saveZone({ ...(f.id ? { id: f.id } : {}), name: f.name, currency: f.currency, regions: f.regions, baseFee: minor(f.baseFee), perKgFee: minor(f.perKgFee || "0"), ...(f.freeOver ? { freeOver: minor(f.freeOver) } : {}), estimate: f.estimate, quotationOnly: f.quotationOnly });
    if (r.ok) { setMsg("Zone saved."); setF(blank); await reload(); } else setErrors(r.errors);
  }
  return (
    <div className="space-y-6">
      <Errors errors={errors} />{msg && <Notice>{msg}</Notice>}
      <p className="text-sm text-muted-foreground">Delivery estimates are shown to customers as estimates, never guarantees. Checkout needs at least one zone.</p>
      <ul className="divide-y divide-border text-sm">{data?.map((z) => (
        <li key={z.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div><p className="font-semibold">{z.name} · {formatMoney({ amount: z.baseFee, currency: z.currency })}{z.quotationOnly && " · quotation only"}</p><p className="text-muted-foreground">{z.regions.join(", ")} · {z.estimate}</p></div>
          <div className="flex gap-3">
            <button className="underline" onClick={() => setF({ id: z.id, name: z.name, currency: z.currency, baseFee: major(z.baseFee), perKgFee: major(z.perKgFee), freeOver: major(z.freeOver), estimate: z.estimate, quotationOnly: !!z.quotationOnly, regions: z.regions })}>Edit</button>
            <button className="underline text-destructive" onClick={() => { if (window.confirm(`Delete zone "${z.name}"?`)) void admin.deleteZone(z.id).then((r) => (r.ok ? reload() : setErrors(r.errors))); }}>Delete</button>
          </div>
        </li>))}{data && !data.length && <li className="py-3 text-muted-foreground">No delivery zones yet.</li>}</ul>
      <form onSubmit={save} className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
        <h2 className="font-display text-lg font-bold sm:col-span-2">{f.id ? "Edit zone" : "Add zone"}</h2>
        <Field label="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <div><label htmlFor="z-cur" className="mb-1 block text-sm font-medium">Currency</label><select id="z-cur" className={inputCls} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as "GHS" | "USD" })}><option>GHS</option><option>USD</option></select></div>
        <Field label="Base fee" type="number" step="0.01" min="0" required value={f.baseFee} onChange={(e) => setF({ ...f, baseFee: e.target.value })} />
        <Field label="Extra fee per kg" type="number" step="0.01" min="0" value={f.perKgFee} onChange={(e) => setF({ ...f, perKgFee: e.target.value })} />
        <Field label="Free delivery over (optional)" type="number" step="0.01" min="0" value={f.freeOver} onChange={(e) => setF({ ...f, freeOver: e.target.value })} />
        <Field label="Delivery estimate" required hint="e.g. 1–2 working days" value={f.estimate} onChange={(e) => setF({ ...f, estimate: e.target.value })} />
        <fieldset className="sm:col-span-2"><legend className="mb-1 text-sm font-medium">Regions served</legend>
          <div className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-4">{GHANA_REGIONS.map((r) => <label key={r} className="flex items-center gap-2"><input type="checkbox" checked={f.regions.includes(r)} onChange={() => toggle(r)} />{r}</label>)}</div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.quotationOnly} onChange={(e) => setF({ ...f, quotationOnly: e.target.checked })} /> Delivery cost is quoted individually</label>
        <div className="flex gap-3 sm:col-span-2"><button className="btn-primary">Save zone</button>{f.id && <button type="button" className="underline" onClick={() => setF(blank)}>Cancel edit</button>}</div>
      </form>
    </div>
  );
}

function Discounts({ admin }: { admin: Admin }) {
  const { data, errors, reload, setErrors } = useLoad<AdminDiscount[]>(useCallback(() => admin.discounts(), [admin]));
  const blank = { code: "", kind: "percent" as AdminDiscount["kind"], value: "", currency: "GHS" as "GHS" | "USD", startsAt: "", endsAt: "", minSubtotal: "", maxRedemptions: "", perCustomerLimit: "", firstPurchaseOnly: false };
  const [f, setF] = useState(blank); const [msg, setMsg] = useState("");
  const describe = (d: AdminDiscount) => d.kind === "percent" ? `${d.value / 100}% off` : d.kind === "fixed" ? `${formatMoney({ amount: d.value, currency: d.currency ?? "GHS" })} off` : "Free shipping";
  async function save(e: React.FormEvent) {
    e.preventDefault(); setMsg(""); setErrors([]);
    const value = f.kind === "free_shipping" ? 0 : f.kind === "percent" ? Math.round(Number(f.value) * 100) : minor(f.value);
    const r = await admin.saveDiscount({
      code: f.code, kind: f.kind, value, ...(f.kind === "fixed" ? { currency: f.currency } : {}),
      ...(f.startsAt ? { startsAt: new Date(f.startsAt).toISOString() } : {}), ...(f.endsAt ? { endsAt: new Date(f.endsAt).toISOString() } : {}),
      ...(f.minSubtotal ? { minSubtotal: minor(f.minSubtotal) } : {}), ...(f.maxRedemptions ? { maxRedemptions: Number(f.maxRedemptions) } : {}), ...(f.perCustomerLimit ? { perCustomerLimit: Number(f.perCustomerLimit) } : {}),
      ...(f.firstPurchaseOnly ? { firstPurchaseOnly: true } : {}),
    });
    if (r.ok) { setMsg("Discount saved."); setF(blank); await reload(); } else setErrors(r.errors);
  }
  return (
    <div className="space-y-6">
      <Errors errors={errors} />{msg && <Notice>{msg}</Notice>}
      <ul className="divide-y divide-border text-sm">{data?.map((d) => (
        <li key={d.code} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div><p className="font-semibold">{d.code} · {describe(d)} {!d.active && <span className="badge-label ml-1">Off</span>}</p>
            <p className="text-muted-foreground">Used {d.redeemed}{d.maxRedemptions !== undefined ? ` of ${d.maxRedemptions}` : ""} times{d.endsAt ? ` · ends ${new Date(d.endsAt).toLocaleDateString()}` : ""}</p></div>
          <button className="underline" onClick={() => void admin.setDiscountActive(d.code, !d.active).then((r) => (r.ok ? reload() : setErrors(r.errors)))}>{d.active ? "Turn off" : "Turn on"}</button>
        </li>))}{data && !data.length && <li className="py-3 text-muted-foreground">No discount codes yet.</li>}</ul>
      <form onSubmit={save} className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
        <h2 className="font-display text-lg font-bold sm:col-span-2">Add or update a code</h2>
        <Field label="Code" required hint="3–32 letters, numbers, - or _" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
        <div><label htmlFor="d-kind" className="mb-1 block text-sm font-medium">Type</label><select id="d-kind" className={inputCls} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as AdminDiscount["kind"] })}><option value="percent">Percentage</option><option value="fixed">Fixed amount</option><option value="free_shipping">Free shipping</option></select></div>
        {f.kind !== "free_shipping" && <Field label={f.kind === "percent" ? "Percent off" : "Amount off"} type="number" step="0.01" min="0" required value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />}
        {f.kind === "fixed" && <div><label htmlFor="d-cur" className="mb-1 block text-sm font-medium">Currency</label><select id="d-cur" className={inputCls} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as "GHS" | "USD" })}><option>GHS</option><option>USD</option></select></div>}
        <Field label="Starts (optional)" type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} />
        <Field label="Ends (optional)" type="datetime-local" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} />
        <Field label="Minimum subtotal (optional)" type="number" step="0.01" min="0" value={f.minSubtotal} onChange={(e) => setF({ ...f, minSubtotal: e.target.value })} />
        <Field label="Total redemption limit (optional)" type="number" min="1" value={f.maxRedemptions} onChange={(e) => setF({ ...f, maxRedemptions: e.target.value })} />
        <Field label="Limit per customer (optional)" type="number" min="1" value={f.perCustomerLimit} onChange={(e) => setF({ ...f, perCustomerLimit: e.target.value })} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.firstPurchaseOnly} onChange={(e) => setF({ ...f, firstPurchaseOnly: e.target.checked })} /> First purchase only</label>
        <button className="btn-primary sm:col-span-2">Save discount</button>
      </form>
    </div>
  );
}

function Categories({ admin }: { admin: Admin }) {
  const { data, errors, reload, setErrors } = useLoad<CategoryNode[]>(useCallback(() => admin.categories(), [admin]));
  const [msg, setMsg] = useState(""); const [name, setName] = useState(""); const [parent, setParent] = useState("");
  const all = data ?? [];
  const run = async (fn: () => Promise<{ ok: boolean; errors: string[] }>, ok: string) => { setMsg(""); setErrors([]); const r = await fn(); if (r.ok) { setMsg(ok); await reload(); } else setErrors(r.errors); };
  const rename = (c: CategoryNode) => { const n = window.prompt("New name", c.name); if (n && n.trim() && n.trim() !== c.name) void run(() => admin.renameCategory(c.id, n), "Renamed."); };
  const Row = ({ c, sibs, idx }: { c: CategoryNode; sibs: CategoryNode[]; idx: number }) => (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span className={c.published ? "" : "text-muted-foreground line-through"}>{c.name}{!c.published && " (hidden)"}</span>
      <span className="flex gap-3 text-sm">
        <button className="underline" disabled={idx === 0} aria-label={`Move ${c.name} up`} onClick={() => void run(() => admin.moveCategory(c.id, idx - 1), "Moved.")}>Up</button>
        <button className="underline" disabled={idx === sibs.length - 1} aria-label={`Move ${c.name} down`} onClick={() => void run(() => admin.moveCategory(c.id, idx + 1), "Moved.")}>Down</button>
        <button className="underline" onClick={() => rename(c)}>Rename</button>
        <button className="underline" onClick={() => void run(() => admin.setCategoryHidden(c.id, c.published), c.published ? "Hidden from the shop, including its products." : "Visible again.")}>{c.published ? "Hide" : "Show"}</button>
      </span>
    </li>
  );
  const tops = all.filter((c) => c.parentId === null).sort((a, b) => a.position - b.position);
  return (
    <div className="space-y-6">
      <Errors errors={errors} />{msg && <Notice>{msg}</Notice>}
      <p className="text-sm text-muted-foreground">Hiding a category hides it, its subcategories and its products from the public shop. Nothing is deleted.</p>
      <ul className="divide-y divide-border">
        {all.filter((c) => c.parentId === null).sort((a, b) => a.position - b.position).map((c, i, arr) => {
          const kids = all.filter((k) => k.parentId === c.id).sort((a, b) => a.position - b.position);
          return (<li key={c.id}><ul><Row c={c} sibs={arr} idx={i} />{kids.length > 0 && <li><ul className="ml-6 divide-y divide-border border-l border-border pl-4">{kids.map((k, j) => <Row key={k.id} c={k} sibs={kids} idx={j} />)}</ul></li>}</ul></li>);
        })}
      </ul>
      <form className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void run(() => admin.addCategory(name, parent || null), "Category added.").then(() => setName("")); }}>
        <h2 className="font-display text-lg font-bold sm:col-span-2">Add category</h2>
        <Field label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
        <div><label htmlFor="c-parent" className="mb-1 block text-sm font-medium">Parent</label>
          <select id="c-parent" className={inputCls} value={parent} onChange={(e) => setParent(e.target.value)}><option value="">None (top level)</option>{tops.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <button className="btn-primary sm:col-span-2">Add category</button>
      </form>
    </div>
  );
}

function Support({ admin }: { admin: Admin }) {
  const { data, errors, reload, setErrors } = useLoad<Ticket[]>(useCallback(() => admin.tickets(), [admin]));
  const [open, setOpen] = useState<string | null>(null); const [reply, setReply] = useState(""); const [internal, setInternal] = useState(false); const [msg, setMsg] = useState("");
  const run = async (fn: () => Promise<{ ok: boolean; errors: string[] }>, ok: string) => { setMsg(""); setErrors([]); const r = await fn(); if (r.ok) { setMsg(ok); setReply(""); await reload(); } else setErrors(r.errors); };
  return (
    <div className="space-y-4">
      <Errors errors={errors} />{msg && <Notice>{msg}</Notice>}
      <p className="text-sm text-muted-foreground">Replies appear in the customer's account under "Messages". Email delivery is not connected yet. Internal notes are never shown to customers.</p>
      <ul className="divide-y divide-border text-sm">{data?.map((t) => (
        <li key={t.id} className="py-3">
          <button className="flex w-full flex-wrap items-center justify-between gap-2 text-left" aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)}>
            <span className="font-semibold">{t.subject}</span><span className="text-muted-foreground">{t.email} · {t.status}</span>
          </button>
          {open === t.id && (
            <div className="mt-3 space-y-3">
              <ol className="space-y-2">{t.messages.map((m) => <li key={`${m.at}${m.author}`} className={`rounded-md p-3 ${m.internal ? "bg-secondary italic" : "border border-border"}`}><p className="text-xs text-muted-foreground">{m.author === "customer" ? "Customer" : "Staff"}{m.internal && " · internal note"} · {new Date(m.at).toLocaleString()}</p><p className="mt-1 whitespace-pre-wrap">{m.body}</p></li>)}</ol>
              <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void run(() => admin.replyTicket(t.id, reply, internal), internal ? "Note saved." : "Reply sent."); }}>
                <label className="block text-sm font-medium" htmlFor={`r-${t.id}`}>Reply</label>
                <textarea id={`r-${t.id}`} rows={4} required className={inputCls} value={reply} onChange={(e) => setReply(e.target.value)} />
                <label className="flex items-center gap-2"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note (not visible to the customer)</label>
                <div className="flex flex-wrap items-center gap-3"><button className="btn-primary">{internal ? "Save note" : "Send reply"}</button>
                  {(["open", "pending", "resolved"] as const).filter((s) => s !== t.status).map((s) => <button type="button" key={s} className="underline" onClick={() => void run(() => admin.setTicketStatus(t.id, s), `Marked ${s}.`)}>Mark {s}</button>)}</div>
              </form>
            </div>
          )}
        </li>))}{data && !data.length && <li className="py-3 text-muted-foreground">No messages yet.</li>}</ul>
    </div>
  );
}

function AnalyticsView({ admin }: { admin: Admin }) {
  const [days, setDays] = useState(30);
  const { data, errors } = useLoad<Analytics>(useCallback(() => admin.analytics(days), [admin, days]));
  const f = data?.funnel;
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
  return (
    <div className="space-y-6">
      <Errors errors={errors} />
      <label className="block text-sm font-medium">Period
        <select className={`${inputCls} mt-1 w-40`} value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select>
      </label>
      <section aria-labelledby="rev"><h2 id="rev" className="font-display text-lg font-bold">Revenue (verified paid orders only)</h2>
        <p className="text-xs text-muted-foreground">Currencies are never added together. Net = paid minus refunds.</p>
        <ul className="mt-2 text-sm">{data && Object.entries(data.revenue).map(([cur, r]) => <li key={cur}>{cur}: net {formatMoney({ amount: r.net, currency: cur as "GHS" | "USD" })} from {r.orders} {r.orders === 1 ? "order" : "orders"} (gross {formatMoney({ amount: r.gross, currency: cur as "GHS" | "USD" })}, refunds {formatMoney({ amount: r.refunds, currency: cur as "GHS" | "USD" })})</li>)}
          {data && Object.keys(data.revenue).length === 0 && <li className="text-muted-foreground">No paid orders in this period.</li>}</ul></section>
      <section aria-labelledby="fun"><h2 id="fun" className="font-display text-lg font-bold">Funnel</h2>
        <p className="text-xs text-muted-foreground">Visitor counts include only people who accepted analytics, so they understate real traffic. Paid orders are exact.</p>
        {f && <table className="mt-2 w-full max-w-md text-left text-sm"><caption className="sr-only">Funnel</caption><tbody>
          <tr><th className="py-1 font-medium">Viewed a product</th><td>{f.productViews}</td><td /></tr>
          <tr><th className="py-1 font-medium">Added to cart</th><td>{f.addToCart}</td><td className="text-muted-foreground">{pct(f.addToCart, f.productViews)}</td></tr>
          <tr><th className="py-1 font-medium">Started checkout</th><td>{f.checkoutStarts}</td><td className="text-muted-foreground">{pct(f.checkoutStarts, f.addToCart)}</td></tr>
          <tr><th className="py-1 font-medium">Paid orders</th><td>{f.paidOrders}</td><td /></tr></tbody></table>}</section>
    </div>
  );
}

const ROLE_HELP: Record<string, string> = { manager: "Everything except staff management", inventory: "Products, stock, categories", fulfilment: "View and update orders", support: "Orders, customers, support inbox", marketing: "Discounts, content, analytics", finance: "Refunds, exports, analytics", analyst: "Read-only products, orders, analytics" };
function StaffTab({ admin }: { admin: Admin }) {
  const { data, errors, reload, setErrors } = useLoad<StaffMember[]>(useCallback(() => admin.staff(), [admin]));
  const [email, setEmail] = useState(""); const [roles, setRoles] = useState<string[]>([]); const [msg, setMsg] = useState(""); const [pw, setPw] = useState(""); const [need, setNeed] = useState(false);
  const run = async (fn: () => Promise<{ ok: boolean; errors: string[] }>, ok: string) => { setMsg(""); setErrors([]); const r = await fn(); if (r.ok) { setMsg(ok); await reload(); } else { setNeed(r.errors.some((e) => /re-?auth/i.test(e))); setErrors(r.errors); } };
  const tog = (r: string, list: string[], set: (v: string[]) => void) => set(list.includes(r) ? list.filter((x) => x !== r) : [...list, r]);
  const editRoles = (m: StaffMember) => { const v = window.prompt(`Roles for ${m.email} (comma separated: ${Object.keys(ROLE_HELP).join(", ")})`, m.roles.join(", ")); if (v) void run(() => admin.setStaffRoles(m.id, v.split(",").map((x) => x.trim()).filter(Boolean)), "Roles updated. They must sign in again."); };
  return (
    <div className="space-y-6">
      <Errors errors={errors} />{msg && <Notice>{msg}</Notice>}
      {need && <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void admin.reauth(pw).then((r) => { if (r.ok) { setNeed(false); setPw(""); setErrors([]); setMsg("Confirmed. Retry the action."); } else setErrors(r.errors); }); }}><input aria-label="Confirm your password" type="password" autoComplete="current-password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} /><button className="btn-primary">Confirm</button></form>}
      <p className="text-sm text-muted-foreground">Invited people choose their own password from a single-use link that expires in 72 hours. Email delivery is not connected yet, so invitations are not sent until a mail provider is configured.</p>
      <ul className="divide-y divide-border text-sm">{data?.map((m) => (
        <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div><p className="font-semibold">{m.email} <span className="badge-label ml-1">{m.state}</span></p><p className="text-muted-foreground">{m.roles.join(", ")}</p></div>
          {!m.roles.includes("owner") && <div className="flex gap-3">
            <button className="underline" onClick={() => editRoles(m)}>Change roles</button>
            {m.state === "invited" ? <button className="underline" onClick={() => void run(() => admin.inviteStaff(m.email, m.roles), "New invitation issued.")}>Re-invite</button>
              : <button className="underline" onClick={() => void run(() => admin.setStaffActive(m.id, m.state !== "active"), m.state === "active" ? "Suspended." : "Reactivated.")}>{m.state === "active" ? "Suspend" : "Reactivate"}</button>}
          </div>}
        </li>))}</ul>
      <form className="space-y-3 rounded-lg border border-border p-4" onSubmit={(e) => { e.preventDefault(); void run(() => admin.inviteStaff(email.trim(), roles), "Invitation created.").then(() => { setEmail(""); setRoles([]); }); }}>
        <h2 className="font-display text-lg font-bold">Invite a team member</h2>
        <Field label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <fieldset><legend className="mb-1 text-sm font-medium">Roles (least access needed)</legend>
          {Object.entries(ROLE_HELP).map(([r, h]) => <label key={r} className="flex items-start gap-2 py-0.5 text-sm"><input type="checkbox" className="mt-1" checked={roles.includes(r)} onChange={() => tog(r, roles, setRoles)} /><span><span className="font-medium capitalize">{r}</span> — {h}</span></label>)}</fieldset>
        <button className="btn-primary" disabled={!roles.length}>Send invitation</button>
      </form>
    </div>
  );
}
