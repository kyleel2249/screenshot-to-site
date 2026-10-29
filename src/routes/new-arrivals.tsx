import { createFileRoute } from "@tanstack/react-router";
import { CatalogCollection } from "@/components/Collection";
import { hasLabel } from "@/lib/storefront";

export const Route = createFileRoute("/new-arrivals")({
  head: () => ({ meta: [{ title: "New arrivals — Dera Darko Trade" }, { name: "description", content: "Fresh stock and just-landed imports." }, { property: "og:title", content: "New arrivals — Dera Darko Trade" }] }),
  component: () => <CatalogCollection title="New arrivals" intro="Fresh stock and just-landed imports." pick={(all) => all.filter((p) => hasLabel(p, "new_arrival") || hasLabel(p, "just_landed"))} empty="No new arrivals right now." />,
});
