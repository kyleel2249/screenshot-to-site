import { createFileRoute } from "@tanstack/react-router";
import { products, viewOf } from "@/lib/catalog";
import { Collection } from "@/components/Collection";

export const Route = createFileRoute("/preorders")({
  head: () => ({ meta: [{ title: "Pre-orders — Dera Darko Trade" }, { name: "description", content: "Reserve imports before they land. Expected arrival windows are set by our team; no dates are promised unless shown." }, { property: "og:title", content: "Pre-orders — Dera Darko Trade" }] }),
  component: () => <Collection title="Pre-orders" intro="Reserve imports before they land. Expected arrival windows are set by our team; no dates are promised unless shown." items={products.filter((p)=>viewOf(p).availability==='pre_order')} empty="No pre-order items are open right now." />,
});
