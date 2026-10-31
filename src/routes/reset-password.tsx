import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/lib/api";
import { Errors, Field, Notice, Page, PASSWORD_HINT } from "@/components/Form";

export const Route = createFileRoute("/reset-password")({
  validateSearch: (s: Record<string, unknown>) => ({ token: typeof s["token"] === "string" ? s["token"] : "" }),
  head: () => ({ meta: [{ title: "Choose a new password — Dera Darko Trade" }, { name: "robots", content: "noindex" }, { name: "referrer", content: "no-referrer" }] }),
  component: Reset,
});
function Reset() {
  const { token } = Route.useSearch();
  const [pw, setPw] = useState(""); const [errors, setErrors] = useState<string[]>([]); const [done, setDone] = useState(false);
  async function submit(e: React.FormEvent) { e.preventDefault(); setErrors([]); const r = await api.reset(token, pw); if (r.ok) { setPw(""); setDone(true); } else setErrors(r.errors); }
  if (!token) return <Page title="Reset link needed"><Notice>This page needs the link from your email. <Link to="/forgot-password" className="underline">Request a new one</Link>.</Notice></Page>;
  if (done) return <Page title="Password updated"><Notice>Your password has been changed and other sessions were signed out. <Link to="/login" className="underline">Sign in</Link>.</Notice></Page>;
  return (
    <Page title="Choose a new password">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Errors errors={errors} />
        <Field label="New password" type="password" autoComplete="new-password" required hint={PASSWORD_HINT} value={pw} onChange={(e) => setPw(e.target.value)} />
        <button className="btn-primary w-full">Update password</button>
      </form>
    </Page>
  );
}
