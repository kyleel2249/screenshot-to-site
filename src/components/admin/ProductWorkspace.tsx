import { useEffect, useMemo, useRef, useState } from "react";
import type { CategoryNode } from "@/lib/domain/categories";
import { topLevel, childrenOf } from "@/lib/domain/categories";
import { Field, inputCls, Errors } from "@/components/Form";
import { suggestSku, suggestSlug, suggestShortDescription, suggestImageAlt } from "@/lib/admin-sku";

/** Default GHS per 1 USD when no approved rate is loaded (owner should set real rate in Pricing). */
const FALLBACK_RATE = 11.47;

export type ProductFormState = {
  name: string;
  sku: string;
  categoryId: string;
  shortDescription: string;
  image: string;
  imageAlt: string;
  priceGhsMajor: string;
  priceUsdMajor: string;
  onHand: string;
  published: boolean;
  availability: string;
};

const empty: ProductFormState = {
  name: "",
  sku: "",
  categoryId: "",
  shortDescription: "",
  image: "/products/placeholder.png",
  imageAlt: "",
  priceGhsMajor: "",
  priceUsdMajor: "",
  onHand: "10",
  published: true,
  availability: "available",
};

export function ProductWorkspace({
  categories,
  existingSkus,
  ghsPerUsd = FALLBACK_RATE,
  busy,
  onSave,
  onUploadImage,
}: {
  categories: CategoryNode[];
  existingSkus: string[];
  ghsPerUsd?: number;
  busy: boolean;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  /** Upload binary to R2 (or data-URL fallback); returns permanent URL for the product record. */
  onUploadImage?: (file: Blob) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
}) {
  const [form, setForm] = useState<ProductFormState>(empty);
  const [skuLocked, setSkuLocked] = useState(false);
  const [priceSource, setPriceSource] = useState<"ghs" | "usd" | null>(null);
  const [localErrors, setLocalErrors] = useState<string[]>([]);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState("");
  const objectUrlRef = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => {
    const tops = topLevel(categories);
    return tops.length ? tops : categories.filter((c) => !c.parentId);
  }, [categories]);

  const categoryName = categories.find((c) => c.id === form.categoryId)?.name ?? "";

  useEffect(() => {
    if (!form.categoryId && categories.length) {
      const first = categories.find((c) => c.parentId) ?? categories[0];
      if (first) setForm((f) => ({ ...f, categoryId: first.id }));
    }
  }, [categories, form.categoryId]);

  useEffect(() => {
    if (skuLocked || !form.categoryId) return;
    const next = suggestSku(form.categoryId, existingSkus);
    setForm((f) => (f.sku === next ? f : { ...f, sku: next }));
  }, [form.categoryId, existingSkus, skuLocked]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  function setName(name: string) {
    setForm((f) => {
      const next = { ...f, name };
      if (!f.shortDescription || f.shortDescription === suggestShortDescription(f.name, categoryName)) {
        next.shortDescription = suggestShortDescription(name, categoryName);
      }
      if (!f.imageAlt || f.imageAlt === suggestImageAlt(f.name, categoryName)) {
        next.imageAlt = suggestImageAlt(name, categoryName);
      }
      return next;
    });
  }

  function onGhs(v: string) {
    setPriceSource("ghs");
    setForm((f) => {
      const next = { ...f, priceGhsMajor: v };
      const n = parseFloat(v);
      if (v.trim() && !Number.isNaN(n) && ghsPerUsd > 0) {
        next.priceUsdMajor = (n / ghsPerUsd).toFixed(2);
      }
      return next;
    });
  }

  function onUsd(v: string) {
    setPriceSource("usd");
    setForm((f) => {
      const next = { ...f, priceUsdMajor: v };
      const n = parseFloat(v);
      if (v.trim() && !Number.isNaN(n) && ghsPerUsd > 0) {
        next.priceGhsMajor = (n * ghsPerUsd).toFixed(2);
      }
      return next;
    });
  }

  function regenerateCopy() {
    setForm((f) => ({
      ...f,
      shortDescription: suggestShortDescription(f.name, categoryName),
      imageAlt: suggestImageAlt(f.name, categoryName),
    }));
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setLocalErrors(["Choose a JPEG, PNG, WebP or GIF image."]);
      return;
    }
    setLocalErrors([]);
    setUploadNote("");

    // Instant local preview
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const localUrl = URL.createObjectURL(file);
    objectUrlRef.current = localUrl;
    setForm((f) => ({
      ...f,
      image: localUrl,
      imageAlt: f.imageAlt.trim() || suggestImageAlt(f.name || file.name.replace(/\.[^.]+$/, ""), categoryName),
    }));

    if (!onUploadImage) {
      setUploadNote("Preview only — server upload not wired; image may not persist on save.");
      return;
    }

    setUploading(true);
    try {
      const result = await onUploadImage(file);
      if (result.ok) {
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
          objectUrlRef.current = null;
        }
        setForm((f) => ({ ...f, image: result.url }));
        setUploadNote("Image uploaded and linked to this product.");
      } else {
        setUploadNote(result.error);
        setLocalErrors([result.error]);
      }
    } catch {
      setUploadNote("Upload failed. Preview still shows your file until you try again.");
    }
    setUploading(false);
  }

  return (
    <div className="grid gap-8 xl:grid-cols-[1fr_minmax(280px,380px)]">
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-xl font-bold text-primary">Add product</h2>
            <p className="text-sm text-muted-foreground">Live preview updates as you type. SKU and copy are suggested automatically.</p>
          </div>
          <button type="button" className="rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-gold/15" onClick={regenerateCopy}>
            Regenerate description & alt
          </button>
        </div>
        <Errors errors={localErrors} />
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const err: string[] = [];
            if (!form.name.trim()) err.push("Name is required");
            if (!form.sku.trim()) err.push("SKU is required");
            if (!form.categoryId) err.push("Category is required");
            if (form.image.startsWith("blob:")) {
              err.push("Wait for image upload to finish, or re-upload the image.");
            }
            if (err.length) {
              setLocalErrors(err);
              return;
            }
            setLocalErrors([]);
            const ghs = form.priceGhsMajor.trim() ? Math.round(parseFloat(form.priceGhsMajor) * 100) : undefined;
            const usd = form.priceUsdMajor.trim() ? Math.round(parseFloat(form.priceUsdMajor) * 100) : undefined;
            void onSave({
              name: form.name.trim(),
              sku: form.sku.trim(),
              categoryId: form.categoryId,
              shortDescription: form.shortDescription.trim() || form.name.trim(),
              image: form.image.trim() || "/products/placeholder.png",
              imageAlt: form.imageAlt.trim() || form.name.trim(),
              priceGhs: ghs,
              priceUsd: usd,
              onHand: parseInt(form.onHand, 10) || 0,
              published: form.published,
              availability: form.availability,
            }).then(() => {
              setForm({ ...empty, categoryId: form.categoryId });
              setSkuLocked(false);
              setPriceSource(null);
              setUploadNote("");
            });
          }}
        >
          <div className="sm:col-span-2">
            <Field label="Product name" required value={form.name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Field
              label="SKU (auto)"
              required
              value={form.sku}
              onChange={(e) => {
                setSkuLocked(true);
                setForm((f) => ({ ...f, sku: e.target.value }));
              }}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {skuLocked ? (
                <button type="button" className="underline" onClick={() => setSkuLocked(false)}>
                  Resume auto-SKU
                </button>
              ) : (
                "Generated from category · unique on save"
              )}
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="ws-cat">
              Category
            </label>
            <select
              id="ws-cat"
              className={inputCls}
              value={form.categoryId}
              onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
              required
            >
              <option value="" disabled>
                Choose…
              </option>
              {groups.map((g) => {
                const leafs = childrenOf(categories, g.id);
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
          </div>
          <div className="sm:col-span-2">
            <Field
              label="Short description"
              value={form.shortDescription}
              onChange={(e) => setForm((f) => ({ ...f, shortDescription: e.target.value }))}
            />
          </div>

          {/* Image upload */}
          <div className="sm:col-span-2 rounded-xl border border-dashed border-border bg-secondary/40 p-4">
            <p className="text-sm font-medium text-primary">Product image</p>
            <p className="mt-1 text-xs text-muted-foreground">JPEG, PNG, WebP or GIF · max ~3 MB. Preview updates immediately.</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
                className="sr-only"
                id="ws-image-file"
                onChange={(e) => void handleFile(e.target.files?.[0])}
              />
              <button
                type="button"
                disabled={uploading || busy}
                className="btn-primary text-sm"
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? "Uploading…" : "Upload image"}
              </button>
              <span className="text-xs text-muted-foreground">or paste a URL below</span>
            </div>
            {uploadNote && <p className="mt-2 text-xs text-muted-foreground">{uploadNote}</p>}
          </div>

          <Field label="Image URL" value={form.image.startsWith("blob:") ? "" : form.image} onChange={(e) => setForm((f) => ({ ...f, image: e.target.value }))} />
          <Field label="Image alt text" value={form.imageAlt} onChange={(e) => setForm((f) => ({ ...f, imageAlt: e.target.value }))} />
          <div>
            <Field label="Price (GHS)" type="number" step="0.01" min="0" value={form.priceGhsMajor} onChange={(e) => onGhs(e.target.value)} />
            {priceSource === "usd" && <p className="mt-1 text-xs text-muted-foreground">Converted from USD</p>}
          </div>
          <div>
            <Field label="Price (USD)" type="number" step="0.01" min="0" value={form.priceUsdMajor} onChange={(e) => onUsd(e.target.value)} />
            {priceSource === "ghs" && <p className="mt-1 text-xs text-muted-foreground">Converted from GHS</p>}
          </div>
          <p className="sm:col-span-2 text-xs text-muted-foreground">
            Rate: 1 USD = {ghsPerUsd.toFixed(2)} GHS {ghsPerUsd === FALLBACK_RATE ? "(default — set approved rate in Pricing when available)" : ""}
          </p>
          <Field label="Stock" type="number" min="0" value={form.onHand} onChange={(e) => setForm((f) => ({ ...f, onHand: e.target.value }))} />
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="ws-av">
              Availability
            </label>
            <select
              id="ws-av"
              className={inputCls}
              value={form.availability}
              onChange={(e) => setForm((f) => ({ ...f, availability: e.target.value }))}
            >
              <option value="available">In stock</option>
              <option value="pre_order">Pre-order</option>
              <option value="coming_soon">Coming soon</option>
              <option value="enquiry">Enquiry required</option>
              <option value="out_of_stock">Out of stock</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={form.published} onChange={(e) => setForm((f) => ({ ...f, published: e.target.checked }))} />
            Publish immediately
          </label>
          <div className="sm:col-span-2 flex flex-wrap gap-2 pt-2">
            <button type="submit" disabled={busy || uploading} className="btn-primary">
              {busy ? "Saving…" : "Save product"}
            </button>
            <button
              type="button"
              className="rounded-full border border-border px-4 py-2 text-sm"
              onClick={() => {
                if (objectUrlRef.current) {
                  URL.revokeObjectURL(objectUrlRef.current);
                  objectUrlRef.current = null;
                }
                setForm({ ...empty, categoryId: form.categoryId });
                setSkuLocked(false);
                setPriceSource(null);
                setUploadNote("");
              }}
            >
              Reset
            </button>
          </div>
        </form>
      </section>

      <aside className="xl:sticky xl:top-6 xl:self-start">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gold-dark">Live preview</p>
        <div
          className="perspective-[1200px]"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = (e.clientX - r.left) / r.width - 0.5;
            const py = (e.clientY - r.top) / r.height - 0.5;
            setTilt({ x: py * -8, y: px * 10 });
          }}
          onMouseLeave={() => setTilt({ x: 0, y: 0 })}
        >
          <article
            className="overflow-hidden rounded-2xl border border-border bg-card shadow-xl transition-transform duration-200 ease-out"
            style={{
              transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) translateZ(0)`,
              transformStyle: "preserve-3d",
            }}
          >
            <div className="relative aspect-square bg-secondary">
              <img
                src={form.image || "/products/placeholder.png"}
                alt={form.imageAlt || form.name || "Product preview"}
                className="h-full w-full object-contain p-4"
                style={{ transform: "translateZ(24px)" }}
              />
              {uploading && (
                <span className="absolute inset-x-0 bottom-0 bg-primary/80 py-1 text-center text-[10px] font-medium text-primary-foreground">
                  Uploading…
                </span>
              )}
              {form.published && (
                <span className="absolute left-3 top-3 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold">
                  Published
                </span>
              )}
            </div>
            <div className="space-y-2 border-t border-border p-4" style={{ transform: "translateZ(12px)" }}>
              <p className="text-xs text-muted-foreground">{categoryName || "Category"}</p>
              <h3 className="font-display text-lg font-bold text-primary">{form.name.trim() || "Product name"}</h3>
              <p className="font-mono text-xs text-muted-foreground">{form.sku || "SKU"}</p>
              <p className="line-clamp-3 text-sm text-muted-foreground">
                {form.shortDescription.trim() || "Short description appears here as you type."}
              </p>
              <div className="pt-1">
                <p className="text-lg font-semibold text-primary">
                  {form.priceGhsMajor.trim()
                    ? `GH₵ ${Number(form.priceGhsMajor).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : "Price on request"}
                </p>
                {form.priceUsdMajor.trim() && (
                  <p className="text-sm text-muted-foreground">
                    USD ${Number(form.priceUsdMajor).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                )}
              </div>
              <p className="text-xs capitalize text-muted-foreground">{form.availability.replace(/_/g, " ")}</p>
              <p className="text-[10px] text-muted-foreground">Slug: {suggestSlug(form.name) || "—"}</p>
            </div>
          </article>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Hover for 3D tilt. Image updates as soon as you choose a file.</p>
      </aside>
    </div>
  );
}
