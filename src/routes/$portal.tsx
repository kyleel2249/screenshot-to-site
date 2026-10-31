/**
 * Staff dashboard — opens automatically (STAFF_OPEN_ACCESS). No login screen.
 */
import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { AdminProduct } from "@/lib/api-client";
import type { CategoryNode } from "@/lib/domain/categories";
import { SEED_CATEGORIES } from "@/lib/domain/categories";
import { Notice } from "@/components/Form";
import { ProductWorkspace } from "@/components/admin/ProductWorkspace";

export const Route = createFileRoute("/$portal")({
  head: () => ({
    meta: [
      { title: "Admin — Dera Darko Trade" },
      { name: "robots", content: "noindex,nofollow,noarchive" },
    ],
  }),
  beforeLoad: ({ params }) => {
    if (/admin/i.test(params.portal)) throw notFound();
    if (!/^[a-z0-9-]{8,}$/i.test(params.portal)) throw notFound();
  },
  component: Dashboard,
});

type Tab = "overview" | "products" | "add" | "categories" | "pricing" | "orders" | "settings";

const NAV: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "products", label: "Products" },
  { id: "add", label: "Add product" },
  { id: "categories", label: "Categories" },
  { id: "pricing", label: "Pricing & currency" },
  { id: "orders", label: "Orders" },
  { id: "settings", label: "Business settings" },
];

function Dashboard() {
  const { portal } = Route.useParams();
  const admin = useMemo(() => api.admin(`/${portal}`), [portal]);
  const [tab, setTab] = useState<Tab>("overview");
  const [roles, setRoles] = useState<string[]>(["owner"]);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [categories, setCategories] = useState<CategoryNode[]>(() => SEED_CATEGORIES.map((c) => ({ ...c })));
  const [overview, setOverview] = useState<{
    products: number;
    published: number;
    orders: number;
    categories: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  const load = useCallback(async () => {
    setError("");
    const me = await admin.me();
    if (me.ok && me.data?.roles?.length) setRoles(me.data.roles);

    const [list, cats, ov, pubCats] = await Promise.all([
      admin.products(),
      admin.categories(),
      admin.overview(),
      api.categories(),
    ]);
    if (list.ok && list.data) setProducts(list.data);
    else if (!list.ok) setError(list.errors.join(" ") || "Could not load products.");
    if (cats.ok && cats.data && cats.data.length) setCategories(cats.data);
    else if (pubCats.ok && pubCats.data && pubCats.data.length) setCategories(pubCats.data);
    else setCategories(SEED_CATEGORIES.map((c) => ({ ...c })));
    if (ov.ok && ov.data) {
      const d = ov.data as { products?: number; published?: number; orders?: number; categories?: number };
      setOverview({
        products: d.products ?? 0,
        published: d.published ?? 0,
        orders: d.orders ?? 0,
        categories: d.categories ?? 0,
      });
    }
    setLoading(false);
  }, [admin]);

  useEffect(() => {
    void load();
  }, [load]);

  async function seedSamples() {
    setBusy(true);
    setMsg("");
    setError("");
    try {
      const res = await fetch(`/${portal}/api/products/seed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: "{}",
      });
      const data = (await res.json()) as { count?: number; error?: string };
      if (!res.ok) setError(data.error || "Seed failed");
      else {
        setMsg(`Added ${data.count ?? 0} sample products.`);
        await load();
        setTab("products");
      }
    } catch {
      setError("Seed request failed.");
    }
    setBusy(false);
  }

  async function togglePublish(p: AdminProduct) {
    setBusy(true);
    setError("");
    const r = await admin.publish(p.id, !p.published);
    if (!r.ok) setError(r.errors.join(" ") || "Publish failed");
    else await load();
    setBusy(false);
  }

  const published = products.filter((p) => p.published).length;
  const drafts = products.length - published;
  const noPrice = products.filter((p) => !p.price?.GHS && !p.price?.USD).length;
  const existingSkus = products.map((p) => p.sku).filter(Boolean) as string[];

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Notice>Opening administration workspace…</Notice>
      </div>
    );
  }

  const Nav = (
    <nav className="space-y-1" aria-label="Admin">
      {NAV.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => {
            setTab(item.id);
            setNavOpen(false);
          }}
          className={`flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
            tab === item.id
              ? "bg-gold/20 text-gold"
              : "text-primary-foreground/80 hover:bg-white/10 hover:text-primary-foreground"
          }`}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-[#F4F6FA]">
      <div className="flex min-h-screen">
        <aside className="hidden w-60 shrink-0 flex-col bg-[#071D49] text-primary-foreground lg:flex">
          <div className="border-b border-white/10 px-4 py-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-gold">Dera Darko Trade</p>
            <p className="mt-1 font-display text-lg font-bold">Admin</p>
            <p className="mt-1 text-xs text-primary-foreground/60">{roles.join(", ") || "owner"} · open access</p>
          </div>
          <div className="flex-1 overflow-y-auto p-3">{Nav}</div>
          <div className="border-t border-white/10 p-3">
            <Link to="/" className="block rounded-lg px-3 py-2 text-sm text-primary-foreground/80 hover:bg-white/10">
              ← View storefront
            </Link>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-border bg-white px-4 py-3 lg:px-8">
            <div className="flex items-center gap-3">
              <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-sm lg:hidden" onClick={() => setNavOpen(true)}>
                Menu
              </button>
              <h1 className="font-display text-lg font-bold text-primary lg:text-xl">
                {NAV.find((n) => n.id === tab)?.label ?? "Dashboard"}
              </h1>
            </div>
            <div className="flex gap-2">
              <button type="button" className="rounded-full border border-border px-3 py-1.5 text-sm" onClick={() => void load()}>
                Refresh
              </button>
              <Link to="/shop" search={{}} className="rounded-full border border-border px-3 py-1.5 text-sm hover:bg-gold/15">
                Shop
              </Link>
            </div>
          </header>

          <main className="flex-1 p-4 lg:p-8">
            {error && (
              <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
            )}
            {msg && <div className="mb-4 rounded-lg border border-border bg-white p-3 text-sm">{msg}</div>}

            {tab === "overview" && (
              <div className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Stat label="Total products" value={overview?.products ?? products.length} />
                  <Stat label="Published" value={overview?.published ?? published} />
                  <Stat label="Drafts" value={drafts} />
                  <Stat label="Missing price" value={noPrice} />
                  <Stat label="Categories" value={overview?.categories ?? categories.length} />
                  <Stat label="Orders" value={overview?.orders ?? 0} />
                </div>
                <div className="rounded-2xl border border-border bg-white p-6 shadow-sm">
                  <h2 className="font-display text-lg font-semibold text-primary">Quick actions</h2>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button type="button" disabled={busy} className="btn-primary" onClick={() => void seedSamples()}>
                      {busy ? "Working…" : "Load sample products"}
                    </button>
                    <button type="button" className="rounded-full border border-border px-4 py-2 text-sm" onClick={() => setTab("add")}>
                      Add product
                    </button>
                    <button type="button" className="rounded-full border border-border px-4 py-2 text-sm" onClick={() => setTab("products")}>
                      Manage catalogue
                    </button>
                  </div>
                </div>
              </div>
            )}

            {tab === "products" && (
              <div>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">{products.length} products</p>
                  <div className="flex gap-2">
                    <button type="button" disabled={busy} className="rounded-full border border-border px-4 py-2 text-sm" onClick={() => void seedSamples()}>
                      Load samples
                    </button>
                    <button type="button" className="btn-primary text-sm" onClick={() => setTab("add")}>
                      Add product
                    </button>
                  </div>
                </div>
                {products.length === 0 ? (
                  <Notice>No products yet. Load samples or add one.</Notice>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-border bg-white">
                    <table className="w-full min-w-[640px] text-left text-sm">
                      <thead className="border-b border-border bg-[#F4F6FA] text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-4 py-3 font-medium">Product</th>
                          <th className="px-4 py-3 font-medium">SKU</th>
                          <th className="px-4 py-3 font-medium">Status</th>
                          <th className="px-4 py-3 font-medium">Stock</th>
                          <th className="px-4 py-3 font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {products.map((p) => (
                          <tr key={p.id}>
                            <td className="px-4 py-3 font-medium text-primary">{p.name}</td>
                            <td className="px-4 py-3 font-mono text-xs">{p.sku ?? "—"}</td>
                            <td className="px-4 py-3">{p.published ? "Published" : "Draft"}</td>
                            <td className="px-4 py-3">{p.onHand}</td>
                            <td className="px-4 py-3">
                              <button type="button" disabled={busy} className="text-xs font-medium text-primary underline" onClick={() => void togglePublish(p)}>
                                {p.published ? "Unpublish" : "Publish"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {tab === "add" && (
              <div className="rounded-2xl border border-border bg-white p-4 shadow-sm lg:p-6">
                <ProductWorkspace
                  categories={categories}
                  existingSkus={existingSkus}
                  busy={busy}
                  onUploadImage={async (file) => {
                    const r = await admin.uploadImage(file);
                    if (r.ok && r.data?.url) return { ok: true as const, url: r.data.url };
                    return { ok: false as const, error: r.errors.join(" ") || "Upload failed" };
                  }}
                  onSave={async (body) => {
                    setBusy(true);
                    setError("");
                    setMsg("");
                    try {
                      const r = await admin.createProduct(body);
                      if (!r.ok) {
                        const detail = r.errors.join(" ") || "Could not create product";
                        setError(detail);
                        throw new Error(detail);
                      }
                      setMsg(`Created ${String(body.name)}`);
                      await load();
                      setTab("products");
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </div>
            )}

            {tab === "categories" && (
              <div className="rounded-2xl border border-border bg-white p-6">
                <h2 className="font-display text-lg font-semibold text-primary">Categories ({categories.length})</h2>
                <ul className="mt-4 max-h-[28rem] space-y-1 overflow-y-auto text-sm">
                  {categories
                    .filter((c) => !c.parentId)
                    .map((g) => (
                      <li key={g.id} className="rounded-lg border border-border p-3">
                        <p className="font-medium text-primary">{g.name}</p>
                        <ul className="mt-2 ml-3 space-y-0.5 text-muted-foreground">
                          {categories
                            .filter((c) => c.parentId === g.id)
                            .map((s) => (
                              <li key={s.id}>{s.name}</li>
                            ))}
                        </ul>
                      </li>
                    ))}
                </ul>
              </div>
            )}

            {tab === "pricing" && (
              <div className="rounded-2xl border border-border bg-white p-6">
                <h2 className="font-display text-lg font-semibold text-primary">Pricing & currency</h2>
                <p className="mt-2 text-sm text-muted-foreground">Default conversion rate 11.47 GHS per USD until an approved rate is stored.</p>
              </div>
            )}

            {tab === "orders" && (
              <div className="rounded-2xl border border-border bg-white p-6">
                <h2 className="font-display text-lg font-semibold text-primary">Orders</h2>
                <p className="mt-2 text-sm text-muted-foreground">Order count: {overview?.orders ?? 0}.</p>
              </div>
            )}

            {tab === "settings" && (
              <div className="rounded-2xl border border-border bg-white p-6">
                <h2 className="font-display text-lg font-semibold text-primary">Business settings</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Portal: <code className="rounded bg-secondary px-1">/{portal}</code>
                </p>
              </div>
            )}
          </main>
        </div>
      </div>

      {navOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setNavOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-60 bg-[#071D49] p-3 text-primary-foreground shadow-xl">
            <p className="mb-4 px-3 text-sm font-semibold text-gold">Menu</p>
            {Nav}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold text-primary">{value}</p>
    </div>
  );
}
