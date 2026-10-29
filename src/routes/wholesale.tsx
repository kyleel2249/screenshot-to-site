import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/wholesale")({
  head: () => ({
    meta: [
      { title: "Wholesale & Business — Dera Darko Trade" },
      { name: "description", content: "Bulk purchasing and business pricing for resellers and companies in Ghana." },
      { property: "og:title", content: "Wholesale & Business — Dera Darko Trade" },
      { property: "og:description", content: "Bulk orders and business partnerships." },
    ],
  }),
  component: () => (
    <div className="container-x max-w-3xl py-16">
      <h1 className="font-display text-4xl font-bold">Wholesale & business buying</h1>
      <p className="mt-4 text-foreground/80 leading-relaxed">
        Resellers, shops and companies can buy in bulk. Tell us the products and quantities you need and we'll
        come back with business pricing and lead times.
      </p>
      <ul className="mt-6 list-disc space-y-2 pl-5 text-sm text-foreground/80">
        <li>Quantity-based pricing</li><li>Bulk preorders from abroad</li><li>Business invoices</li>
      </ul>
      <Link to="/contact" className="btn-primary mt-8">Send an enquiry</Link>
    </div>
  ),
});
