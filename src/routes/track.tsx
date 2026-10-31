import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/lib/api";
import { Errors, Field, Page } from "@/components/Form";
import { labelOf } from "@/lib/order-labels";
import { PayPanel } from "@/components/PayPanel";
import type { TrackResult } from "@/lib/api-client";

export const Route = createFileRoute("/track")({
  validateSearch: (s: Record<string, unknown>) => ({ ref: typeof s["ref"] === "string" ? s["ref"] : "" }),
  head: () => ({ meta: [{ title: "Track your order — Dera Darko Trade" }, { name: "robots", content: "noindex" }] }),
  component: Track,
});
function Track() {
  const s = Route.useSearch();
  const [ref, setRef] = useState(s.ref); const [secret, setSecret] = useState("");
  const [res, setRes] = useState<TrackResult | null>(null); const [errors, setErrors] = useState<string[]>([]);
  async function go(e: React.FormEvent) {
    e.preventDefault(); setErrors([]); setRes(null);
    const r = await api.track(ref.trim(), secret.trim());
    if (r.ok && r.data) setRes(r.data); else setErrors(r.status === 404 ? ["We couldn't find an order with those details."] : r.errors);
  }
  return (
    <Page title="Track your order">
      <form onSubmit={go} className="space-y-4" noValidate>
        <Errors errors={errors} />
        <Field label="Order reference" required value={ref} onChange={(e) => setRef(e.target.value)} />
        <Field label="Tracking code" required hint="Shown once when you placed the order. Signed-in customers can use their account instead." value={secret} onChange={(e) => setSecret(e.target.value)} />
        <button className="btn-primary w-full">Track</button>
      </form>
      {res && (
        <section aria-live="polite" className="card-elevated p-5">
          <p className="font-semibold">Status: {labelOf(res.status)}</p>
          {res.hasPreorder && <p className="mt-1 text-sm text-muted-foreground">Contains pre-order items; dates are estimates.</p>}
          {res.payBy !== null && <div className="mt-4 border-t border-border pt-4"><PayPanel orderRef={res.ref} trackingSecret={secret.trim()} total={res.total} currency={res.currency} payBy={res.payBy} /></div>}
          <ol className="mt-3 space-y-1 text-sm">{res.history.map((h) => <li key={`${h.to}${h.at}`}>{new Date(h.at).toLocaleString()} — {labelOf(h.to)}</li>)}</ol>
        </section>
      )}
    </Page>
  );
}
