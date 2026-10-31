import { createFileRoute } from "@tanstack/react-router";
import { PageView } from "@/components/PageView";

export const Route = createFileRoute("/about")({
  head: () => ({ meta: [{ title: "About — Dera Darko Trade" }, { name: "description", content: "About Dera Darko Trade, an import and trade business serving shoppers, resellers and wholesale buyers in Ghana." }] }),
  component: () => <PageView slug="about" />,
});
