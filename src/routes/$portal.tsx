import { createFileRoute, notFound } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { AdminOrder, AdminProduct } from "@/lib/api-client";
import { formatMoney } from "@/lib/domain/money";
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

type Tab = "products" | "orders" | "audit";
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
        {(["products", "orders", "audit"] as Tab[]).map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-full px-4 py-2 text-sm font-medium capitalize ${tab === t ? "bg-primary text-primary-foreground" : "border border-border"}`}>{t}</button>)}
      </nav>
      <div className="mt-6">{tab === "products" ? <Products admin={admin} /> : tab === "orders" ? <Orders admin={admin} /> : <Audit admin={admin} />}</div>
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
        <Field label="Category id" required value={nw.categoryId} onChange={(e) => setNw({ ...nw, categoryId: e.target.value })} />
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
