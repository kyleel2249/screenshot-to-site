import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ApiOrder } from "@/lib/api-client";
import { formatMoney } from "@/lib/domain/money";
import { labelOf } from "@/lib/order-labels";
import { Errors, Field, inputCls, Notice, Page } from "@/components/Form";

export const Route = createFileRoute("/account")({
  head: () => ({ meta: [{ title: "My account — Dera Darko Trade" }, { name: "robots", content: "noindex" }] }),
  component: Account,
});

type Profile = { email: string; firstName: string; lastName: string; emailVerified: boolean; phone?: string; preferredCurrency?: "GHS" | "USD" };
type Address = { id: string; recipient: string; region: string; city: string; street: string; isDefault: boolean };

function Account() {
  const nav = useNavigate();
  const [me, setMe] = useState<Profile | null | undefined>(undefined);
  const [orders, setOrders] = useState<ApiOrder[]>([]); const [addrs, setAddrs] = useState<Address[]>([]);
  const [msg, setMsg] = useState(""); const [errors, setErrors] = useState<string[]>([]);
  const [p, setP] = useState({ firstName: "", lastName: "", phone: "" });
  const [a, setA] = useState({ recipient: "", region: "", city: "", street: "" });

  const load = useCallback(async () => {
    const m = await api.me();
    if (!m.ok || !m.data) { setMe(null); return; }
    setMe(m.data as Profile); setP({ firstName: m.data.firstName, lastName: m.data.lastName, phone: (m.data as Profile).phone ?? "" });
    const [o, ad] = await Promise.all([api.orders(), api.addresses()]);
    if (o.data) setOrders(o.data); if (ad.data) setAddrs(ad.data as Address[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<{ ok: boolean; errors: string[] }>, done: string) => { setErrors([]); setMsg(""); const r = await fn(); if (r.ok) { setMsg(done); await load(); } else setErrors(r.errors); };

  async function download() {
    const r = await api.exportData(); if (!r.ok) return setErrors(r.errors);
    const url = URL.createObjectURL(new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" }));
    const el = document.createElement("a"); el.href = url; el.download = "my-data.json"; el.click(); URL.revokeObjectURL(url);
  }
  async function remove() {
    if (!window.confirm("Permanently delete your account? Order records the law requires us to keep are anonymised, not erased. This cannot be undone.")) return;
    const r = await api.deleteAccount(); if (r.ok) void nav({ to: "/" }); else setErrors(r.errors);
  }

  if (me === undefined) return <Page title="My account"><Notice>Loading…</Notice></Page>;
  if (me === null) return <Page title="My account"><Notice>Please <Link to="/login" className="underline">sign in</Link> to see your account.</Notice></Page>;

  return (
    <Page title={`Hello, ${me.firstName}`} narrow={false}>
      <Errors errors={errors} />{msg && <Notice>{msg}</Notice>}
      {!me.emailVerified && <Notice>Your email isn't verified yet. Check your inbox for the verification link.</Notice>}
      <div className="grid gap-8 lg:grid-cols-2">
        <section className="space-y-3" aria-labelledby="prof"><h2 id="prof" className="font-display text-xl font-bold">Profile</h2>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run(() => api.updateProfile({ firstName: p.firstName, lastName: p.lastName, ...(p.phone ? { phone: p.phone } : {}) }), "Profile saved."); }}>
            <Field label="First name" value={p.firstName} onChange={(e) => setP({ ...p, firstName: e.target.value })} />
            <Field label="Last name" value={p.lastName} onChange={(e) => setP({ ...p, lastName: e.target.value })} />
            <Field label="Phone" type="tel" value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} />
            <label className="block text-sm font-medium">Preferred currency
              <select className={`${inputCls} mt-1`} value={me.preferredCurrency ?? "GHS"} onChange={(e) => void run(() => api.updateProfile({ preferredCurrency: e.target.value as "GHS" | "USD" }), "Currency saved.")}><option value="GHS">GHS</option><option value="USD">USD</option></select>
            </label>
            <button className="btn-primary">Save profile</button>
          </form>
        </section>
        <section className="space-y-3" aria-labelledby="addr"><h2 id="addr" className="font-display text-xl font-bold">Addresses</h2>
          <ul className="space-y-2 text-sm">{addrs.map((x) => <li key={x.id} className="rounded-md border border-border p-3">{x.recipient}, {x.street}, {x.city}, {x.region}{x.isDefault && <span className="badge-label ml-2">Default</span>}</li>)}{!addrs.length && <li className="text-muted-foreground">No saved addresses.</li>}</ul>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run(() => api.addAddress({ ...a, makeDefault: addrs.length === 0 }), "Address added.").then(() => setA({ recipient: "", region: "", city: "", street: "" })); }}>
            <Field label="Recipient" required value={a.recipient} onChange={(e) => setA({ ...a, recipient: e.target.value })} />
            <Field label="Region" required value={a.region} onChange={(e) => setA({ ...a, region: e.target.value })} />
            <Field label="Town / city" required value={a.city} onChange={(e) => setA({ ...a, city: e.target.value })} />
            <Field label="Street / landmark" required value={a.street} onChange={(e) => setA({ ...a, street: e.target.value })} />
            <button className="btn-primary">Add address</button>
          </form>
        </section>
      </div>
      <section aria-labelledby="ord"><h2 id="ord" className="font-display text-xl font-bold">Orders</h2>
        <ul className="mt-3 divide-y divide-border">{orders.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <div><p className="font-semibold">{o.ref} · {labelOf(o.status)}</p><p className="text-muted-foreground">{new Date(o.createdAt).toLocaleDateString()} · {o.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}</p></div>
            <div className="flex items-center gap-3"><span className="font-semibold">{formatMoney({ amount: o.total, currency: o.currency })}</span>
              {["pending_payment", "payment_confirmed", "processing"].includes(o.status) && <button className="underline" onClick={() => void run(() => api.cancelOrder(o.id), "Cancellation requested.")}>Request cancellation</button>}</div>
          </li>))}{!orders.length && <li className="py-3 text-muted-foreground">No orders yet.</li>}</ul>
      </section>
      <section className="flex flex-wrap gap-3 border-t border-border pt-6" aria-label="Privacy and session">
        <button className="rounded-full border border-border px-4 py-2 text-sm" onClick={() => void download()}>Download my data</button>
        <button className="rounded-full border border-border px-4 py-2 text-sm" onClick={() => void api.logout().then(() => nav({ to: "/" }))}>Sign out</button>
        <button className="rounded-full border border-destructive px-4 py-2 text-sm text-destructive" onClick={() => void remove()}>Delete my account</button>
      </section>
    </Page>
  );
}
