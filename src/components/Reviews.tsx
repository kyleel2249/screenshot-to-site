import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ReviewList } from "@/lib/api-client";
import { Errors, Field, inputCls, Notice } from "@/components/Form";

export const Stars = ({ value }: { value: number }) => <span aria-hidden="true" className="text-gold-dark">{"★".repeat(Math.round(value))}<span className="text-border">{"★".repeat(5 - Math.round(value))}</span></span>;

export function Reviews({ slug }: { slug: string }) {
  const [data, setData] = useState<ReviewList | null>(null); const [errors, setErrors] = useState<string[]>([]); const [sent, setSent] = useState(false);
  const [f, setF] = useState({ rating: 5, title: "", body: "" });
  const load = useCallback(async () => { const r = await api.reviews(slug); if (r.ok && r.data) setData(r.data); }, [slug]);
  useEffect(() => { void load(); }, [load]);
  if (!data) return null;
  async function submit(e: React.FormEvent) { e.preventDefault(); setErrors([]); const r = await api.submitReview(slug, f); if (r.ok) { setSent(true); await load(); } else setErrors(r.errors); }
  return (
    <section aria-labelledby="reviews-h" className="container-x max-w-3xl pb-16">
      <h2 id="reviews-h" className="font-display text-2xl font-bold">Customer reviews</h2>
      {data.summary.count > 0 ? <p className="mt-1 text-sm"><Stars value={data.summary.average} /> <span className="sr-only">{data.summary.average} out of 5, </span>{data.summary.average} · {data.summary.count} {data.summary.count === 1 ? "review" : "reviews"}</p> : <p className="mt-1 text-sm text-muted-foreground">No reviews yet. Only customers whose order was delivered can review.</p>}
      <ul className="mt-4 divide-y divide-border">{data.reviews.map((r) => (
        <li key={`${r.at}${r.author}`} className="py-4 text-sm"><p><Stars value={r.rating} /><span className="sr-only"> {r.rating} out of 5</span> {r.title && <strong className="ml-1">{r.title}</strong>}</p><p className="mt-1 whitespace-pre-line text-foreground/80">{r.body}</p><p className="mt-1 text-xs text-muted-foreground">{r.author} · verified buyer · {new Date(r.at).toLocaleDateString()}</p></li>))}</ul>
      {data.myReview && <div className="mt-4"><Notice>{data.myReview.status === "pending" ? "Thanks — your review is awaiting approval." : data.myReview.status === "published" ? "Your review is published." : "Your review wasn't published."}</Notice></div>}
      {sent && !data.myReview && <div className="mt-4"><Notice>Thanks — your review is awaiting approval.</Notice></div>}
      {data.canReview && !sent && (
        <form onSubmit={submit} className="mt-6 space-y-3 rounded-lg border border-border p-4" noValidate>
          <h3 className="font-semibold">Write a review</h3><Errors errors={errors} />
          <div><label htmlFor="rv-rating" className="mb-1 block text-sm font-medium">Rating</label><select id="rv-rating" className={`${inputCls} w-32`} value={f.rating} onChange={(e) => setF({ ...f, rating: Number(e.target.value) })}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} star{n > 1 && "s"}</option>)}</select></div>
          <Field label="Title (optional)" maxLength={100} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <div><label htmlFor="rv-body" className="mb-1 block text-sm font-medium">Your review</label><textarea id="rv-body" rows={4} required className={inputCls} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></div>
          <button className="btn-primary">Submit for approval</button>
        </form>
      )}
    </section>
  );
}
