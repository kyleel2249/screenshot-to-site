/**
 * The shop dashboard. Open by design: no sign-in, password, two-step verification or enrolment (see docs/OPEN_ADMIN.md).
 * A static route wins over /$portal.
 */
import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/components/admin/Dashboard";

export const Route = createFileRoute("/dera-owner-console")({
  head: () => ({ meta: [{ title: "Dashboard" }, { name: "robots", content: "noindex,nofollow,noarchive" }, { name: "referrer", content: "no-referrer" }] }),
  component: ConsoleDashboard,
});

function ConsoleDashboard() {
  return <Dashboard portal="dera-owner-console" />;
}
