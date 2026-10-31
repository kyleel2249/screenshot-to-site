import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/lib/api";
import { Errors, Field, Notice, Page, PASSWORD_HINT } from "@/components/Form";

export const Route = createFileRoute("/accept-invite")({
  validateSearch: (s: Record<string, unknown>) => ({ token: typeof s["token"] === "string" ? s["token"] : "" }),
  head: () => ({ meta: [{ title: "Accept invitation" }, { name: "robots", content: "noindex,nofollow" }, { name: "referrer", content: "no-referrer" }] }),
  component: Accept,
});
function Accept() {
  const { token } = Route.useSearch();
  const [pw, setPw] = useState(""); const [errors, setErrors] = useState<string[]>([]); const [done, setDone] = useState(false);
  async function submit(e: React.FormEvent) { e.preventDefault(); setErrors([]); const r = await api.acceptInvite(token, pw); if (r.ok) { setPw(""); setDone(true); } else setErrors(r.errors); }
  if (!token) return <Page title="Invitation needed"><Notice>Open the link from your invitation email.</Notice></Page>;
  if (done) return <Page title="Welcome aboard"><Notice>Your password is set. Sign in at the staff address you were given. <Link to="/" className="underline">Home</Link></Notice></Page>;
  return (
    <Page title="Choose your password">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Errors errors={errors} />
        <Field label="Password" type="password" autoComplete="new-password" required hint={PASSWORD_HINT} value={pw} onChange={(e) => setPw(e.target.value)} />
        <button className="btn-primary w-full">Activate account</button>
      </form>
    </Page>
  );
}
