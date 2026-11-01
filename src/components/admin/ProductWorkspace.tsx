import { useEffect, useMemo, useRef, useState } from "react";
import type { CategoryNode } from "@/lib/domain/categories";
import { topLevel, childrenOf } from "@/lib/domain/categories";
import { Field, inputCls, Errors } from "@/components/Form";
import { suggestSku, suggestSlug, suggestShortDescription, suggestImageAlt } from "@/lib/admin-sku";

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

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read image file"));
    reader.readAsDataURL(file);
  });
}

function isPersistableImageUrl(url: string): boolean {
  if (!url || url.startsWith("blob:")) return false;
  return (
    url.startsWith("/media/") ||
    url.startsWith("/products/") ||
    url.startsWith("data:image/") ||
    url.startsWith("https://") ||
    url.startsWith("http://")
  );
}

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
  onUploadImage?: (file: Blob) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
}) {
  const [form, setForm] = useState<ProductFormState>(empty);
  const [skuLocked, setSkuLocked] = useState(false);
  const [priceSource, setPriceSource] = useState<"ghs" | "usd" | null>(null);
  const [localErrors, setLocalErrors] = useState<string[]>([]);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState("");
  const [saving, setSaving] = useState(false);
  const objectUrlRef = useRef<string | null>(null);
  /** Always the latest non-blob image URL for save (avoids stale React state). */
  const imageUrlRef = useRef<string>(empty.image);
  const pendingUploadRef = useRef<Promise<string> | null>(null);
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
      if (v.trim() && !Number.isNaN(n) && ghsPerUsd > 0) next.priceUsdMajor = (n / ghsPerUsd).toFixed(2);
      return next;
    });
  }

  function onUsd(v: string) {
    setPriceSource("usd");
    setForm((f) => {
      const next = { ...f, priceUsdMajor: v };
      const n = parseFloat(v);
      if (v.trim() && !Number.isNaN(n) && ghsPerUsd > 0) next.priceGhsMajor = (n * ghsPerUsd).toFixed(2);
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

  function applyImageUrl(url: string) {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    imageUrlRef.current = url;
    setForm((f) => ({ ...f, image: url }));
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setLocalErrors(["Choose a JPEG, PNG, WebP or GIF image."]);
      return;
    }
    setLocalErrors([]);
    setUploadNote("Uploading…");

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const localUrl = URL.createObjectURL(file);
    objectUrlRef.current = localUrl;
    setForm((f) => ({
      ...f,
      image: localUrl,
      imageAlt: f.imageAlt.trim() || suggestImageAlt(f.name || file.name.replace(/\.[^.]+$/, ""), categoryName),
    }));

    const job = (async (): Promise<string> => {
      if (onUploadImage) {
        try {
          const result = await onUploadImage(file);
          if (result.ok && result.url && isPersistableImageUrl(result.url)) {
            return result.url;
          }
        } catch {
          /* fall through to data URL */
        }
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        if (dataUrl.startsWith("data:image/")) return dataUrl;
      } catch {
        /* ignore */
      }
      return "/products/placeholder.png";
    })();

    pendingUploadRef.current = job;
    setUploading(true);
    try {
      const url = await job;
      applyImageUrl(url);
      setUploadNote(
        url.startsWith("/media/")
          ? "Image uploaded and ready to save."
          : url.startsWith("data:image/")
            ? "Image ready (embedded). You can save the product."
            : "Using placeholder image — try upload again if needed.",
      );
    } finally {
      if (pendingUploadRef.current === job) pendingUploadRef.current = null;
      setUploading(false);
    }
  }

  async function submitForm() {
    const err: string[] = [];
    if (!form.name.trim()) err.push("Name is required");
    if (!form.sku.trim()) err.push("SKU is required");
    if (!form.categoryId) err.push("Category is required");
    if (err.length) {
      setLocalErrors(err);
      return;
    }
    setLocalErrors([]);

    setSaving(true);
    try {
      // Finish any in-flight upload before save — never show “wait for upload” as a hard stop
      if (pendingUploadRef.current) {
        setUploadNote("Finishing image…");
        try {
          const url = await pendingUploadRef.current;
          applyImageUrl(url);
        } catch {
          /* keep whatever we have */
        }
      }

      let image = imageUrlRef.current || form.image.trim() || "/products/placeholder.png";
      if (!isPersistableImageUrl(image)) {
        image = "/products/placeholder.png";
      }

      const ghsRaw = form.priceGhsMajor.trim() ? Math.round(parseFloat(form.priceGhsMajor) * 100) : undefined;
      const usdRaw = form.priceUsdMajor.trim() ? Math.round(parseFloat(form.priceUsdMajor) * 100) : undefined;
      const ghs = ghsRaw !== undefined && Number.isFinite(ghsRaw) ? ghsRaw : undefined;
      const usd = usdRaw !== undefined && Number.isFinite(usdRaw) ? usdRaw : undefined;

      await onSave({
        name: form.name.trim(),
        sku: form.sku.trim(),
        categoryId: form.categoryId,
        shortDescription: form.shortDescription.trim() || form.name.trim(),
        image,
        imageAlt: form.imageAlt.trim() || form.name.trim(),
        priceGhs: ghs,
        priceUsd: usd,
        onHand: parseInt(form.onHand, 10) || 0,
        // A product can only go live with a price; without one it is saved as a draft instead of failing.
        published: form.published && (ghs !== undefined || usd !== undefined),
        availability: form.availability,
      });

      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      imageUrlRef.current = empty.image;
      setForm({ ...empty, categoryId: form.categoryId });
      setSkuLocked(false);
      setPriceSource(null);
      setUploadNote("");
    } catch (ex) {
      setLocalErrors([ex instanceof Error ? ex.message : "Save failed. Try again."]);
    }
    setSaving(false);
  }

  const locked = busy || saving;

  return (
    <div className="grid gap-8 xl:grid-cols-[1fr_minmax(280px,380px)]">
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-xl font-bold text-primary">Add product</h2>
            <p className="text-sm text-muted-foreground">
              Upload an image (preview updates instantly), enter a name and price, then Save.
            </p>
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
            void submitForm();
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
            <Field label="Short description" value={form.shortDescription} onChange={(e) => setForm((f) => ({ ...f, shortDescription: e.target.value }))} />
          </div>
          <div className="sm:col-span-2 rounded-xl border border-dashed border-border bg-secondary/40 p-4">
            <p className="text-sm font-medium text-primary">Product image</p>
            <p className="mt-1 text-xs text-muted-foreground">JPEG, PNG, WebP or GIF · max ~3 MB. Save works even if upload is still finishing.</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
                className="sr-only"
                id="ws-image-file"
                onChange={(e) => void handleFile(e.target.files?.[0])}
              />
              <button type="button" disabled={uploading || locked} className="btn-primary text-sm" onClick={() => fileRef.current?.click()}>
                {uploading ? "Uploading…" : "Upload image"}
              </button>
              <span className="text-xs text-muted-foreground">or paste a URL below</span>
            </div>
            {uploadNote && <p className="mt-2 text-xs text-muted-foreground">{uploadNote}</p>}
          </div>
          <Field
            label="Image URL"
            value={form.image.startsWith("blob:") ? "" : form.image.startsWith("data:image/") ? "(embedded image ready)" : form.image}
            onChange={(e) => {
              const v = e.target.value;
              if (v.startsWith("(embedded")) return;
              imageUrlRef.current = v;
              setForm((f) => ({ ...f, image: v }));
            }}
          />
          <Field label="Image alt text" value={form.imageAlt} onChange={(e) => setForm((f) => ({ ...f, imageAlt: e.target.value }))} />
          <div>
            <Field label="Price (GHS)" type="number" step="0.01" min="0" value={form.priceGhsMajor} onChange={(e) => onGhs(e.target.value)} />
          </div>
          <div>
            <Field label="Price (USD)" type="number" step="0.01" min="0" value={form.priceUsdMajor} onChange={(e) => onUsd(e.target.value)} />
          </div>
          <p className="sm:col-span-2 text-xs text-muted-foreground">
            Rate: 1 USD = {ghsPerUsd.toFixed(2)} GHS. Publish needs at least one price (otherwise saved as draft).
          </p>
          <Field label="Stock" type="number" min="0" value={form.onHand} onChange={(e) => setForm((f) => ({ ...f, onHand: e.target.value }))} />
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="ws-av">
              Availability
            </label>
            <select id="ws-av" className={inputCls} value={form.availability} onChange={(e) => setForm((f) => ({ ...f, availability: e.target.value }))}>
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
            {form.published && !form.priceGhsMajor.trim() && !form.priceUsdMajor.trim() && (
              <span className="text-xs text-muted-foreground">(needs a price, otherwise it is saved as a draft)</span>
            )}
          </label>
          <div className="sm:col-span-2 flex flex-wrap gap-2 pt-2">
            <button type="submit" disabled={locked} className="btn-primary">
              {saving || busy ? "Saving…" : "Save product"}
            </button>
            <button
              type="button"
              className="rounded-full border border-border px-4 py-2 text-sm"
              onClick={() => {
                if (objectUrlRef.current) {
                  URL.revokeObjectURL(objectUrlRef.current);
                  objectUrlRef.current = null;
                }
                imageUrlRef.current = empty.image;
                pendingUploadRef.current = null;
                setForm({ ...empty, categoryId: form.categoryId });
                setSkuLocked(false);
                setPriceSource(null);
                setUploadNote("");
                setLocalErrors([]);
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
              {(uploading || saving) && (
                <span className="absolute inset-x-0 bottom-0 bg-primary/80 py-1 text-center text-[10px] font-medium text-primary-foreground">
                  {uploading ? "Uploading…" : "Saving…"}
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
      </aside>
    </div>
  );
}
