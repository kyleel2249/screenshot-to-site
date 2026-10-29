import { createFileRoute } from "@tanstack/react-router";
import { products, viewOf } from "@/lib/catalog";
import { Collection } from "@/components/Collection";

export const Route = createFileRoute("/new-arrivals")({
  head: () => ({ meta: [{ title: "New arrivals — Dera Darko Trade" }, { name: "description", content: "Fresh stock and just-landed imports." }, { property: "og:title", content: "New arrivals — Dera Darko Trade" }] }),
  component: () => (
    <Collection
      title="New arrivals"
      intro="Fresh stock and just-landed imports."
      items={products.filter((p) => { const l = viewOf(p).labels; return l.includes("new_arrival") || l.includes("just_landed"); })}
      empty="No new arrivals right now."
    />
  ),
});
