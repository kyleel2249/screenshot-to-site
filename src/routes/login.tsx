import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/lib/api";
import { Errors, Field, Page } from "@/components/Form";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — Dera Darko Trade" }, { name: "robots", content: "noindex" }] }),
  component: Login,
});

function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState(""); const [pw, setPw] = useState("");
  const [errors, setErrors] = useState<string[]>([]); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErrors([]);
    const r = await api.login(email.trim(), pw);
    setBusy(false);
    if (r.ok) { setPw(""); void nav({ to: "/account" }); } else setErrors(r.errors);
  }
  return (
    <Page title="Sign in">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Errors errors={errors} />
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Password" type="password" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} />
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <p className="text-sm"><Link to="/forgot-password" className="underline">Forgot your password?</Link> · <Link to="/register" className="underline">Create an account</Link></p>
    </Page>
  );
}
