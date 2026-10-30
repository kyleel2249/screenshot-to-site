import { createFileRoute } from "@tanstack/react-router";
import { PageView } from "@/components/PageView";

export const Route = createFileRoute("/faq")({
  head: () => ({ meta: [{ title: "FAQ — Dera Darko Trade" }, { name: "description", content: "Answers about pre-orders, availability, currencies, wholesale and product information." }] }),
  component: () => <PageView slug="faq" />,
});
