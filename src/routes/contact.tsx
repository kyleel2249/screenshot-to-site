import { createFileRoute } from "@tanstack/react-router";
import { business } from "@/lib/catalog";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact — Dera Darko Trade" },
      { name: "description", content: "Get in touch with Dera Darko Trade about orders, preorders and delivery." },
      { property: "og:title", content: "Contact — Dera Darko Trade" },
      { property: "og:description", content: "Questions about orders or preorders? Contact us." },
    ],
  }),
  component: () => (
    <div className="container-x max-w-2xl py-16">
      <h1 className="font-display text-4xl font-bold">Contact us</h1>
      <p className="mt-4 text-muted-foreground">Questions about an order, a preorder or delivery? Reach our team.</p>
      <dl className="card-elevated mt-8 grid gap-4 p-6 text-sm">
        <div><dt className="font-semibold text-primary">Email</dt><dd>{business.email}</dd></div>
        <div><dt className="font-semibold text-primary">Phone</dt><dd>{business.phone}</dd></div>
        <div><dt className="font-semibold text-primary">Location</dt><dd>{business.location}</dd></div>
      </dl>
    </div>
  ),
});
