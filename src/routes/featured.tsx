import { createFileRoute } from "@tanstack/react-router";
import { products, viewOf } from "@/lib/catalog";
import { Collection } from "@/components/Collection";

export const Route = createFileRoute("/featured")({
  head: () => ({ meta: [{ title: "Featured — Dera Darko Trade" }, { name: "description", content: "Hand-picked by our team." }, { property: "og:title", content: "Featured — Dera Darko Trade" }] }),
  component: () => <Collection title="Featured" intro="Hand-picked by our team." items={products.filter((p)=>viewOf(p).labels.includes('featured'))} empty="Nothing featured right now." />,
});
