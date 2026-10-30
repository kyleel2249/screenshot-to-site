import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/lib/api";
import { Errors, Field, inputCls, Notice, Page } from "@/components/Form";
import { GHANA_REGIONS } from "@/lib/domain/regions";

export const Route = createFileRoute("/wholesale")({
  head: () => ({ meta: [{ title: "Wholesale & bulk orders — Dera Darko Trade" }, { name: "description", content: "Request a written wholesale or bulk-order quote." }] }),
  component: Wholesale,
});

function Wholesale() {
  const [f, setF] = useState({ business: "", contactName: "", email: "", phone: "", region: "", notes: "" });
  const [items, setItems] = useState([{ description: "", qty: "" }]);
  const [errors, setErrors] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [done, setDone] = useState<{ ref: string; secret: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErrors([]);
    const r = await api.requestQuote({ ...f, items: items.map((i) => ({ description: i.description, qty: Number(i.qty) })) });
    setBusy(false);
    if (r.ok && r.data) setDone(r.data); else setErrors(r.errors);
  }
  if (done) return (
    <Page title="Quote request received">
      <Notice>Thank you. Our team will price your request and a written quote will appear on your status page and we'll email you. Prices are never final until quoted.</Notice>
      <div className="rounded-md border border-border p-4 text-sm"><p className="font-semibold">Save these — the access code is shown only once.</p>
        <p className="mt-2">Reference: <strong>{done.ref}</strong></p><code className="mt-1 block break-all rounded bg-secondary p-2">{done.secret}</code>
        <Link to="/quote-status" search={{ ref: done.ref }} className="mt-3 inline-block underline">Check quote status</Link></div>
    </Page>
  );
  return (
    <Page title="Wholesale & bulk orders" narrow={false}>
      <p className="max-w-2xl text-sm text-muted-foreground">Tell us what you need. We reply with a written quote that is valid for a stated period.</p>
      <form onSubmit={submit} className="max-w-2xl space-y-4" noValidate>
        <Errors errors={errors} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name (optional)" value={f.business} onChange={set("business")} />
          <Field label="Contact name" autoComplete="name" required value={f.contactName} onChange={set("contactName")} />
          <Field label="Email" type="email" autoComplete="email" required value={f.email} onChange={set("email")} />
          <Field label="Phone (optional)" type="tel" autoComplete="tel" value={f.phone} onChange={set("phone")} />
        </div>
        <div><label htmlFor="w-region" className="mb-1 block text-sm font-medium">Delivery region</label>
          <select id="w-region" className={inputCls} required value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })}><option value="" disabled>Choose…</option>{GHANA_REGIONS.map((r) => <option key={r}>{r}</option>)}</select></div>
        <fieldset className="space-y-2"><legend className="text-sm font-medium">Items</legend>
          {items.map((it, i) => (
            <div key={i} className="flex gap-2">
              <input aria-label={`Item ${i + 1} description`} placeholder="Product / description" className={inputCls} value={it.description} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
              <input aria-label={`Item ${i + 1} quantity`} placeholder="Qty" type="number" min="1" className={`${inputCls} w-24`} value={it.qty} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
              {items.length > 1 && <button type="button" className="underline" onClick={() => setItems(items.filter((_, j) => j !== i))}>Remove</button>}
            </div>))}
          {items.length < 30 && <button type="button" className="underline text-sm" onClick={() => setItems([...items, { description: "", qty: "" }])}>Add another item</button>}
        </fieldset>
        <div><label htmlFor="w-notes" className="mb-1 block text-sm font-medium">Notes (optional)</label><textarea id="w-notes" rows={4} className={inputCls} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Sending…" : "Request a quote"}</button>
      </form>
      <p className="text-sm">Already asked? <Link to="/quote-status" search={{ ref: "" }} className="underline">Check your quote</Link></p>
    </Page>
  );
}
