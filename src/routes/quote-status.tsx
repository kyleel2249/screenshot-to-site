import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/lib/api";
import type { QuoteView } from "@/lib/api-client";
import { formatMoney } from "@/lib/domain/money";
import { Errors, Field, Notice, Page } from "@/components/Form";

export const Route = createFileRoute("/quote-status")({
  validateSearch: (s: Record<string, unknown>) => ({ ref: typeof s["ref"] === "string" ? s["ref"] : "" }),
  head: () => ({ meta: [{ title: "Quote status — Dera Darko Trade" }, { name: "robots", content: "noindex" }] }),
  component: QuoteStatus,
});
const LABEL: Record<QuoteView["status"], string> = { new: "Received — being priced", quoted: "Quoted", accepted: "Accepted", declined: "Declined", expired: "Quote expired" };

function QuoteStatus() {
  const s = Route.useSearch();
  const [ref, setRef] = useState(s.ref); const [secret, setSecret] = useState("");
  const [q, setQ] = useState<QuoteView | null>(null); const [errors, setErrors] = useState<string[]>([]);
  const apply = (r: { ok: boolean; data: QuoteView | null; status: number; errors: string[] }) => { if (r.ok && r.data) { setQ(r.data); setErrors([]); } else setErrors(r.status === 404 ? ["We couldn't find a quote with those details."] : r.errors); };
  return (
    <Page title="Your quote">
      <form onSubmit={(e) => { e.preventDefault(); setQ(null); void api.quoteStatus(ref.trim(), secret.trim()).then(apply); }} className="space-y-4" noValidate>
        <Errors errors={errors} />
        <Field label="Reference" required value={ref} onChange={(e) => setRef(e.target.value)} />
        <Field label="Access code" required hint="Shown once when you made the request." value={secret} onChange={(e) => setSecret(e.target.value)} />
        <button className="btn-primary w-full">Check</button>
      </form>
      {q && (
        <section aria-live="polite" className="card-elevated space-y-3 p-5 text-sm">
          <p className="font-semibold">{q.ref} · {LABEL[q.status]}</p>
          <ul className="list-disc pl-5">{q.items.map((i, n) => <li key={n}>{i.qty} × {i.description}</li>)}</ul>
          {q.quote && <div className="rounded-md bg-secondary p-3"><p className="text-lg font-semibold text-primary">{formatMoney({ amount: q.quote.total, currency: q.quote.currency })}</p>
            <p>Valid until {new Date(q.quote.validUntil).toLocaleDateString()}.</p>{q.quote.message && <p className="mt-1 whitespace-pre-wrap">{q.quote.message}</p>}</div>}
          {q.status === "quoted" && <div className="flex gap-3">
            <button className="btn-primary" onClick={() => void api.respondToQuote(ref.trim(), secret.trim(), true).then(apply)}>Accept quote</button>
            <button className="rounded-full border border-border px-6 py-3 text-sm font-semibold" onClick={() => void api.respondToQuote(ref.trim(), secret.trim(), false).then(apply)}>Decline</button></div>}
          {q.status === "accepted" && <Notice>Accepted. We will contact you to arrange payment and delivery.</Notice>}
        </section>
      )}
    </Page>
  );
}
