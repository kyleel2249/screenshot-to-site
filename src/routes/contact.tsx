import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/lib/api";
import { Errors, Field, inputCls, Notice, Page } from "@/components/Form";

export const Route = createFileRoute("/contact")({
  head: () => ({ meta: [{ title: "Contact — Dera Darko Trade" }, { name: "description", content: "Get in touch with Dera Darko Trade." }] }),
  component: () => <Enquiry title="Contact us" subject="Website enquiry" intro="Send us a message and we'll reply by email." />,
});

export function Enquiry({ title, subject, intro }: { title: string; subject: string; intro: string }) {
  const [f, setF] = useState({ email: "", subject, body: "" }); const [errors, setErrors] = useState<string[]>([]); const [sent, setSent] = useState(false);
  async function go(e: React.FormEvent) { e.preventDefault(); setErrors([]); const r = await api.support({ ...f, email: f.email.trim() }); if (r.ok) setSent(true); else setErrors(r.errors); }
  if (sent) return <Page title="Message sent"><Notice>Thank you. We'll reply to {f.email} as soon as we can.</Notice></Page>;
  return (
    <Page title={title}>
      <p className="text-sm text-muted-foreground">{intro}</p>
      <form onSubmit={go} className="space-y-4" noValidate>
        <Errors errors={errors} />
        <Field label="Your email" type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <Field label="Subject" required value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />
        <div><label htmlFor="msg" className="mb-1 block text-sm font-medium">Message</label><textarea id="msg" rows={6} required className={inputCls} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></div>
        <button className="btn-primary w-full">Send</button>
      </form>
    </Page>
  );
}
