import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/about")({
  head: () => ({ meta: [{ title: "About — Dera Darko Trade" }, { name: "description", content: "About Dera Darko Trade, an import and trade business serving shoppers, resellers and wholesale buyers in Ghana." }] }),
  component: () => (
    <div className="container-x max-w-3xl py-16">
      <h1 className="font-display text-4xl font-bold">About Dera Darko Trade</h1>
      <p className="mt-4 leading-relaxed text-foreground/80">Dera Darko Trade sells imported products to shoppers, resellers and business buyers in Ghana, with in-stock items, pre-orders and bulk purchasing.</p>
      <p className="mt-4 rounded-md bg-secondary p-4 text-sm text-muted-foreground">Business registration details, address, supplier relationships and any certifications will be published here only once supplied and verified by the owner.</p>
    </div>
  ),
});
