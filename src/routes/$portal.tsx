/**
 * Staff dashboard. TEMP open access: no sign-in / enrol / MFA — dashboard only.
 */
import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { AdminProduct } from "@/lib/api-client";
import { Notice } from "@/components/Form";

export const Route = createFileRoute("/$portal")({
  head: () => ({
    meta: [
      { title: "Dashboard" },
      { name: "robots", content: "noindex,nofollow,noarchive" },
    ],
  }),
  beforeLoad: ({ params }) => {
    if (/admin/i.test(params.portal)) throw notFound();
    if (!/^[a-z0-9-]{8,}$/i.test(params.portal)) throw notFound();
  },
  component: Dashboard,
});

function Dashboard() {
  const { portal } = Route.useParams();
  const admin = useMemo(() => api.admin(`/${portal}`), [portal]);
  const [roles, setRoles] = useState<string[]>(["owner"]);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError("");
    const me = await admin.me();
    if (me.ok && me.data?.roles?.length) setRoles(me.data.roles);
    const list = await admin.products();
    if (list.ok && list.data) setProducts(list.data);
    else if (!list.ok) setError(list.errors.join(" ") || "Could not load products.");
    setLoading(false);
  }, [admin]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="container-x py-16">
        <Notice>Opening dashboard…</Notice>
      </div>
    );
  }

  return (
    <div className="container-x py-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-primary">
            Dashboard <span className="badge-label ml-2">{roles.join(", ") || "owner"}</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Open access — no sign-in required</p>
        </div>
        <div className="flex gap-2">
          <Link to="/shop" className="rounded-full border border-border px-4 py-2 text-sm hover:bg-gold/15">
            View shop
          </Link>
          <button type="button" className="rounded-full border border-border px-4 py-2 text-sm hover:bg-gold/15" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
      )}

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold text-primary">Products ({products.length})</h2>
        <p className="mt-1 text-sm text-muted-foreground">Catalogue from the admin API. Publish items so they appear on the shop.</p>
        <div className="mt-4">
          {products.length === 0 ? (
            <Notice>No products yet.</Notice>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {products.slice(0, 100).map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground">{p.sku ?? p.slug}</span>
                  <span className={p.published ? "text-primary" : "text-muted-foreground"}>{p.published ? "Published" : "Draft"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
