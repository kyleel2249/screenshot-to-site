import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Notice, Page } from "@/components/Form";

export const Route = createFileRoute("/verify-email")({
  validateSearch: (s: Record<string, unknown>) => ({ token: typeof s["token"] === "string" ? s["token"] : "" }),
  head: () => ({ meta: [{ title: "Verify email — Dera Darko Trade" }, { name: "robots", content: "noindex" }, { name: "referrer", content: "no-referrer" }] }),
  component: Verify,
});
function Verify() {
  const { token } = Route.useSearch();
  const [state, setState] = useState<"working" | "ok" | "bad">(token ? "working" : "bad");
  useEffect(() => { if (token) void api.verifyEmail(token).then((r) => setState(r.ok ? "ok" : "bad")); }, [token]);
  return (
    <Page title="Email verification">
      {state === "working" && <Notice>Verifying…</Notice>}
      {state === "ok" && <Notice>Your email is verified. <Link to="/login" className="underline">Sign in</Link>.</Notice>}
      {state === "bad" && <Notice>This verification link is invalid or has expired. Sign in and request a new one from your account.</Notice>}
    </Page>
  );
}
