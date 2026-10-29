import { createFileRoute } from "@tanstack/react-router";
import { CatalogCollection } from "@/components/Collection";
import { hasLabel } from "@/lib/storefront";

export const Route = createFileRoute("/featured")({
  head: () => ({ meta: [{ title: "Featured — Dera Darko Trade" }, { name: "description", content: "Hand-picked by our team." }, { property: "og:title", content: "Featured — Dera Darko Trade" }] }),
  component: () => <CatalogCollection title="Featured" intro="Hand-picked by our team." pick={(all) => all.filter((p) => hasLabel(p, "featured"))} empty="Nothing featured right now." />,
});
