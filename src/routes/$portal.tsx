/**
 * Catch-all for a single unknown path segment. The dashboard lives at /dera-owner-console (a static route that wins over this one),
 * so any other segment is simply "not found".
 */
import { createFileRoute, notFound } from "@tanstack/react-router";

export const Route = createFileRoute("/$portal")({
  head: () => ({ meta: [{ title: "Not found" }, { name: "robots", content: "noindex,nofollow,noarchive" }] }),
  beforeLoad: () => {
    throw notFound();
  },
  component: () => null,
});
