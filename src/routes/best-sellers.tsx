import { createFileRoute } from "@tanstack/react-router";
import { CatalogCollection } from "@/components/Collection";
import { hasLabel } from "@/lib/storefront";

export const Route = createFileRoute("/best-sellers")({
  head: () => ({ meta: [{ title: "Best sellers — Dera Darko Trade" }, { name: "description", content: "Products flagged as best sellers by our team." }, { property: "og:title", content: "Best sellers — Dera Darko Trade" }] }),
  component: () => <CatalogCollection title="Best sellers" intro="Products flagged as best sellers by our team." pick={(all) => all.filter((p) => hasLabel(p, "best_seller"))} empty="No best sellers flagged yet." />,
});
