import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/lib/api";
import { Errors, Field, Notice, Page } from "@/components/Form";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Reset password — Dera Darko Trade" }, { name: "robots", content: "noindex" }] }),
  component: Forgot,
});
function Forgot() {
  const [email, setEmail] = useState(""); const [sent, setSent] = useState(false); const [errors, setErrors] = useState<string[]>([]);
  async function submit(e: React.FormEvent) { e.preventDefault(); setErrors([]); const r = await api.forgot(email.trim()); if (r.ok) setSent(true); else setErrors(r.errors); }
  if (sent) return <Page title="Check your email"><Notice>If an account exists for that address, a reset link has been sent. It expires in 30 minutes and can be used once.</Notice></Page>;
  return (
    <Page title="Reset your password">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Errors errors={errors} />
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="btn-primary w-full">Send reset link</button>
      </form>
    </Page>
  );
}
