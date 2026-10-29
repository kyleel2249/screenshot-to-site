import { createFileRoute } from "@tanstack/react-router";
import { products, viewOf } from "@/lib/catalog";
import { Collection } from "@/components/Collection";

export const Route = createFileRoute("/best-sellers")({
  head: () => ({ meta: [{ title: "Best sellers — Dera Darko Trade" }, { name: "description", content: "Products flagged as best sellers by our team." }, { property: "og:title", content: "Best sellers — Dera Darko Trade" }] }),
  component: () => <Collection title="Best sellers" intro="Products flagged as best sellers by our team." items={products.filter((p)=>viewOf(p).labels.includes('best_seller'))} empty="No best sellers flagged yet." />,
});
