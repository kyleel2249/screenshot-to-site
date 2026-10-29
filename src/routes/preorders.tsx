import { createFileRoute } from "@tanstack/react-router";
import { CatalogCollection } from "@/components/Collection";
import { withAvailability } from "@/lib/storefront";

export const Route = createFileRoute("/preorders")({
  head: () => ({ meta: [{ title: "Pre-orders — Dera Darko Trade" }, { name: "description", content: "Reserve imports before they land. Expected arrival windows are set by our team; no dates are promised unless shown." }, { property: "og:title", content: "Pre-orders — Dera Darko Trade" }] }),
  component: () => <CatalogCollection title="Pre-orders" intro="Reserve imports before they land. Expected arrival windows are set by our team; no dates are promised unless shown." pick={(all) => withAvailability(all, "pre_order")} empty="No pre-order items are open right now." />,
});
