/**
 * TEMP open-access staff dashboard — no sign-in, enrol, or MFA.
 * Static route wins over /$portal so /dera-owner-console always shows this page.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { AdminProduct } from "@/lib/api-client";
import { Notice } from "@/components/Form";

export const Route = createFileRoute("/dera-owner-console")({
  head: () => ({
    meta: [
      { title: "Dashboard — Dera Darko Trade" },
      { name: "robots", content: "noindex,nofollow,noarchive" },
    ],
  }),
  component: OpenDashboard,
});

function OpenDashboard() {
  const admin = useMemo(() => api.admin("/dera-owner-console"), []);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setError("");
    const me = await admin.me();
    if (!me.ok) {
      setReady(true);
      setError(me.errors.join(" ") || "Could not reach admin API. Redeploy latest main if this persists.");
      return;
    }
    setReady(true);
    const list = await admin.products();
    if (list.ok && list.data) setProducts(list.data);
  }, [admin]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ready) {
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
          <p className="text-xs font-semibold uppercase tracking-wide text-gold-dark">Dera Darko Trade</p>
          <h1 className="font-display text-2xl font-bold text-primary">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Open access — no sign-in required (temporary).</p>
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
      {msg && <div className="mt-4 rounded-lg border border-border bg-muted p-3 text-sm">{msg}</div>}

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold text-primary">Products ({products.length})</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Catalogue products from the admin API. Publish them so they appear on the shop.
        </p>
        <div className="mt-4">
          {products.length === 0 ? (
            <Notice>No products in the catalogue yet.</Notice>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {products.slice(0, 50).map((p) => (
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

      <section className="mt-10 grid gap-4 sm:grid-cols-3">
        <Link to="/shop" className="card-elevated block p-5 hover:ring-2 hover:ring-gold/40">
          <p className="font-semibold text-primary">Shop</p>
          <p className="mt-1 text-sm text-muted-foreground">Browse the public catalogue</p>
        </Link>
        <button type="button" className="card-elevated p-5 text-left hover:ring-2 hover:ring-gold/40" onClick={() => void load()}>
          <p className="font-semibold text-primary">Refresh</p>
          <p className="mt-1 text-sm text-muted-foreground">Reload products from the API</p>
        </button>
        <button
          type="button"
          className="card-elevated p-5 text-left hover:ring-2 hover:ring-gold/40"
          onClick={() => {
            setMsg("Open access is on. Set STAFF_OPEN_ACCESS = false in src/lib/security/open-access.ts before production.");
          }}
        >
          <p className="font-semibold text-primary">Security note</p>
          <p className="mt-1 text-sm text-muted-foreground">Temporary unlock — turn off for production</p>
        </button>
      </section>
    </div>
  );
}
