import { createFileRoute } from "@tanstack/react-router";
import { Enquiry } from "./contact";

export const Route = createFileRoute("/wholesale")({
  head: () => ({ meta: [{ title: "Wholesale & bulk orders — Dera Darko Trade" }, { name: "description", content: "Request a wholesale or bulk-order quote." }] }),
  component: () => <Enquiry title="Wholesale & bulk orders" subject="Wholesale quote request" intro="Tell us what you need, quantities and delivery area. We'll respond with a written quote; prices are never shown as final until confirmed." />,
});
