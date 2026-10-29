import { createFileRoute } from "@tanstack/react-router";
import { products, viewOf } from "@/lib/catalog";
import { Collection } from "@/components/Collection";

export const Route = createFileRoute("/deals")({
  head: () => ({ meta: [{ title: "Deals — Dera Darko Trade" }, { name: "description", content: "Products with a currently valid sale price." }, { property: "og:title", content: "Deals — Dera Darko Trade" }] }),
  component: () => <Collection title="Deals" intro="Products with a currently valid sale price." items={products.filter((p)=>viewOf(p).labels.includes('on_sale'))} empty="No active deals right now." />,
});
