import { createFileRoute, notFound } from "@tanstack/react-router";
import { PageView } from "@/components/PageView";
import { DEFAULT_PAGES, isLegal, isPageSlug } from "@/lib/content";

export const Route = createFileRoute("/policies/$slug")({
  beforeLoad: ({ params }) => { if (!isPageSlug(params.slug) || !isLegal(params.slug)) throw notFound(); },
  head: ({ params }) => ({ meta: [{ title: `${isPageSlug(params.slug) ? DEFAULT_PAGES[params.slug].title : "Policy"} — Dera Darko Trade` }] }),
  component: () => { const { slug } = Route.useParams(); return isPageSlug(slug) ? <PageView slug={slug} /> : null; },
});
