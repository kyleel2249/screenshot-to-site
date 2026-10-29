import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/lib/api";
import { Errors, Field, Notice, Page, PASSWORD_HINT } from "@/components/Form";

export const Route = createFileRoute("/register")({
  head: () => ({ meta: [{ title: "Create account — Dera Darko Trade" }, { name: "robots", content: "noindex" }] }),
  component: Register,
});

function Register() {
  const [f, setF] = useState({ firstName: "", lastName: "", email: "", password: "" });
  const [terms, setTerms] = useState(false); const [marketing, setMarketing] = useState(false);
  const [errors, setErrors] = useState<string[]>([]); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErrors([]);
    const r = await api.register({ ...f, email: f.email.trim(), acceptTerms: terms, marketingConsent: marketing });
    setBusy(false);
    if (r.ok) setDone(true); else setErrors(r.errors);
  }
  if (done) return <Page title="Check your email"><Notice>If this email can be registered, we have sent a verification link. Open it to activate your account, then <Link to="/login" className="underline">sign in</Link>.</Notice></Page>;
  return (
    <Page title="Create your account">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Errors errors={errors} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" autoComplete="given-name" required value={f.firstName} onChange={set("firstName")} />
          <Field label="Last name" autoComplete="family-name" required value={f.lastName} onChange={set("lastName")} />
        </div>
        <Field label="Email" type="email" autoComplete="email" required value={f.email} onChange={set("email")} />
        <Field label="Password" type="password" autoComplete="new-password" required hint={PASSWORD_HINT} value={f.password} onChange={set("password")} />
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={terms} onChange={(e) => setTerms(e.target.checked)} required /> I accept the <Link to="/policies/$slug" params={{ slug: "terms" }} className="underline">Terms</Link> and <Link to="/policies/$slug" params={{ slug: "privacy" }} className="underline">Privacy Policy</Link>.</label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} /> Send me offers and news (optional; you can opt out any time).</label>
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
      </form>
    </Page>
  );
}
