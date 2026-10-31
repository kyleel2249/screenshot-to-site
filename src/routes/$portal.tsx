/**
 * Staff dashboard — TEMP open access: no sign-in. Overview, seed catalogue, add & publish products.
 */
import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { AdminProduct } from "@/lib/api-client";
import type { CategoryNode } from "@/lib/domain/categories";
import { SEED_CATEGORIES, topLevel, childrenOf } from "@/lib/domain/categories";
import { Notice, Field, inputCls, Errors } from "@/components/Form";

export const Route = createFileRoute("/$portal")({
  head: () => ({
    meta: [
      { title: "Dashboard — Dera Darko Trade" },
      { name: "robots", content: "noindex,nofollow,noarchive" },
    ],
  }),
  beforeLoad: ({ params }) => {
    if (/admin/i.test(params.portal)) throw notFound();
    if (!/^[a-z0-9-]{8,}$/i.test(params.portal)) throw notFound();
  },
  component: Dashboard,
});

type Tab = "overview" | "products" | "add";

function Dashboard() {
  const { portal } = Route.useParams();
  const admin = useMemo(() => api.admin(`/${portal}`), [portal]);
  const [tab, setTab] = useState<Tab>("overview");
  const [roles, setRoles] = useState<string[]>(["owner"]);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [categories, setCategories] = useState<CategoryNode[]>(() => SEED_CATEGORIES.map((c) => ({ ...c })));
  const [overview, setOverview] = useState<{ products: number; published: number; orders: number; categories: number } | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

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
        categories: d.categories ?? categories.length,
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
      const res = await fetch(`${portal}/api/products/seed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: "{}",
      });
      const data = (await res.json()) as { count?: number; error?: string };
      if (!res.ok) setError(data.error || "Seed failed");
      else {
        setMsg(`Added ${data.count ?? 0} sample products (published).`);
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

  if (loading) {
    return (
      <div className="container-x py-16">
        <Notice>Opening dashboard…</Notice>
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "products", label: "Products" },
    { id: "add", label: "Add product" },
  ];

  return (
    <div className="container-x py-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gold-dark">Dera Darko Trade</p>
          <h1 className="font-display text-2xl font-bold text-primary">
            Dashboard <span className="badge-label ml-2">{roles.join(", ") || "owner"}</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Open access — no sign-in required</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/shop" className="rounded-full border border-border px-4 py-2 text-sm hover:bg-gold/15">
            View shop
          </Link>
          <button type="button" className="rounded-full border border-border px-4 py-2 text-sm hover:bg-gold/15" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </header>

      <nav className="mt-6 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`rounded-full px-4 py-2 text-sm font-medium ${tab === t.id ? "bg-primary text-primary-foreground" : "border border-border hover:bg-gold/15"}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {error && (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
      )}
      {msg && <div className="mt-4 rounded-lg border border-border bg-secondary p-3 text-sm">{msg}</div>}

      {tab === "overview" && (
        <section className="mt-8 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Products" value={overview?.products ?? products.length} />
            <Stat label="Published" value={overview?.published ?? products.filter((p) => p.published).length} />
            <Stat label="Categories" value={overview?.categories ?? categories.length} />
            <Stat label="Orders" value={overview?.orders ?? 0} />
          </div>
          <div className="rounded-xl border border-border p-6">
            <h2 className="font-display text-lg font-semibold text-primary">Get started</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The catalogue is empty until you add products. Load sample items (with GHS/USD prices and images), then open the shop.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" disabled={busy} className="btn-primary" onClick={() => void seedSamples()}>
                {busy ? "Working…" : "Load sample products"}
              </button>
              <button type="button" className="rounded-full border border-border px-4 py-2 text-sm" onClick={() => setTab("add")}>
                Add product manually
              </button>
            </div>
          </div>
        </section>
      )}

      {tab === "products" && (
        <section className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-lg font-semibold text-primary">Products ({products.length})</h2>
            <button type="button" disabled={busy} className="rounded-full border border-border px-4 py-2 text-sm" onClick={() => void seedSamples()}>
              Load samples
            </button>
          </div>
          {products.length === 0 ? (
            <div className="mt-4">
              <Notice>No products yet. Use “Load sample products” on Overview, or add one manually.</Notice>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
              {products.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  {"image" in p && (p as { image?: string }).image ? (
                    <img src={(p as { image?: string }).image} alt="" className="h-12 w-12 rounded-md object-contain bg-secondary" />
                  ) : (
                    <div className="h-12 w-12 rounded-md bg-secondary" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-muted-foreground">{p.sku ?? p.slug}</p>
                  </div>
                  <span className={p.published ? "text-primary font-medium" : "text-muted-foreground"}>
                    {p.published ? "Published" : "Draft"}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-full border border-border px-3 py-1 text-xs hover:bg-gold/15"
                    onClick={() => void togglePublish(p)}
                  >
                    {p.published ? "Unpublish" : "Publish"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "add" && (
        <AddProductForm
          categories={categories}
          busy={busy}
          onSubmit={async (body) => {
            setBusy(true);
            setError("");
            setMsg("");
            const r = await admin.createProduct(body);
            setBusy(false);
            if (!r.ok) {
              setError(r.errors.join(" ") || "Could not create product");
              return;
            }
            setMsg(`Created ${body.name as string}`);
            await load();
            setTab("products");
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold text-primary">{value}</p>
    </div>
  );
}

function AddProductForm({
  categories,
  busy,
  onSubmit,
}: {
  categories: CategoryNode[];
  busy: boolean;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const groups = useMemo(() => {
    const tops = topLevel(categories);
    if (tops.length) return tops;
    return categories.filter((c) => !c.parentId);
  }, [categories]);

  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [priceGhs, setPriceGhs] = useState("");
  const [priceUsd, setPriceUsd] = useState("");
  const [onHand, setOnHand] = useState("10");
  const [shortDescription, setShortDescription] = useState("");
  const [image, setImage] = useState("/products/placeholder.png");
  const [imageAlt, setImageAlt] = useState("");
  const [published, setPublished] = useState(true);
  const [localErrors, setLocalErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!categoryId && categories.length) {
      const first = categories.find((c) => c.parentId) ?? categories[0];
      if (first) setCategoryId(first.id);
    }
  }, [categories, categoryId]);

  return (
    <section className="mt-8 max-w-xl">
      <h2 className="font-display text-lg font-semibold text-primary">Add product</h2>
      <p className="mt-1 text-sm text-muted-foreground">Prices are in major units (e.g. 85.00 GHS). They are stored as minor units.</p>
      <Errors errors={localErrors} />
      <form
        className="mt-4 grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const err: string[] = [];
          if (!name.trim()) err.push("Name is required");
          if (!sku.trim()) err.push("SKU is required");
          if (!categoryId) err.push("Category is required");
          if (err.length) {
            setLocalErrors(err);
            return;
          }
          setLocalErrors([]);
          const ghs = priceGhs.trim() ? Math.round(parseFloat(priceGhs) * 100) : undefined;
          const usd = priceUsd.trim() ? Math.round(parseFloat(priceUsd) * 100) : undefined;
          void onSubmit({
            name: name.trim(),
            sku: sku.trim(),
            categoryId,
            shortDescription: shortDescription.trim() || name.trim(),
            image: image.trim() || "/products/placeholder.png",
            imageAlt: imageAlt.trim() || name.trim(),
            priceGhs: ghs,
            priceUsd: usd,
            onHand: parseInt(onHand, 10) || 0,
            published,
            availability: "available",
          });
        }}
      >
        <Field label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="SKU" required value={sku} onChange={(e) => setSku(e.target.value)} />
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="cat">
            Category
          </label>
          <select id="cat" className={inputCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
            <option value="" disabled>
              Choose a category…
            </option>
            {groups.map((g) => {
              const kids = childrenOf(categories, g.id);
              const leafs = kids.length ? kids : categories.filter((c) => c.parentId === g.id);
              return (
                <optgroup key={g.id} label={g.name}>
                  <option value={g.id}>{g.name} (general)</option>
                  {leafs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            {categories.length ? `${categories.length} categories · ${groups.length} top-level groups` : "No categories loaded — refresh the page."}
          </p>
        </div>
        <Field label="Price (GHS)" type="number" step="0.01" min="0" value={priceGhs} onChange={(e) => setPriceGhs(e.target.value)} />
        <Field label="Price (USD)" type="number" step="0.01" min="0" value={priceUsd} onChange={(e) => setPriceUsd(e.target.value)} />
        <Field label="Stock" type="number" min="0" value={onHand} onChange={(e) => setOnHand(e.target.value)} />
        <Field label="Short description" value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} />
        <Field label="Image URL" value={image} onChange={(e) => setImage(e.target.value)} />
        <Field label="Image alt text" value={imageAlt} onChange={(e) => setImageAlt(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
          Publish immediately
        </label>
        <button type="submit" disabled={busy} className="btn-primary mt-2">
          {busy ? "Saving…" : "Create product"}
        </button>
      </form>
    </section>
  );
}
