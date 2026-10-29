import { createFileRoute } from "@tanstack/react-router";
import { CatalogCollection } from "@/components/Collection";
import { hasLabel } from "@/lib/storefront";

export const Route = createFileRoute("/deals")({
  head: () => ({ meta: [{ title: "Deals — Dera Darko Trade" }, { name: "description", content: "Products with a currently valid sale price." }, { property: "og:title", content: "Deals — Dera Darko Trade" }] }),
  component: () => <CatalogCollection title="Deals" intro="Products with a currently valid sale price." pick={(all) => all.filter((p) => hasLabel(p, "on_sale"))} empty="No active deals right now." />,
});
