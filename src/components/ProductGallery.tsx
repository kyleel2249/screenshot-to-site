import { useEffect, useState } from "react";
import type { StoreProduct } from "@/lib/storefront";

function resolveMain(p: Pick<StoreProduct, "image" | "variantId">): string {
  const raw = (p.image || "").trim();
  if (raw && raw !== "/") return raw;
  const sku = p.variantId?.includes("::") ? p.variantId.split("::")[1] : "";
  return sku ? `/products/${sku}.png` : "";
}

const FALLBACK =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="816" height="816" viewBox="0 0 816 816">
      <rect width="816" height="816" fill="#F4F6FA"/>
      <circle cx="408" cy="380" r="110" fill="#071D49" opacity="0.1"/>
    </svg>`,
  );

/** Main image plus approved extra images. */
export function ProductGallery({ p }: { p: Pick<StoreProduct, "image" | "imageAlt" | "gallery" | "variantId" | "name"> }) {
  const main = resolveMain(p);
  const all = [{ url: main || FALLBACK, alt: p.imageAlt || p.name }, ...(p.gallery ?? []).map((g) => ({ url: g.url, alt: g.alt }))];
  const [i, setI] = useState(0);
  const [broken, setBroken] = useState<Record<number, boolean>>({});
  useEffect(() => {
    setI(0);
    setBroken({});
  }, [p.image, p.variantId]);
  const cur = all[Math.min(i, all.length - 1)]!;
  const curSrc = broken[i] ? FALLBACK : cur.url;

  return (
    <div>
      <div className="product-card-3d-stage aspect-square overflow-hidden rounded-2xl border border-border">
        <img
          src={curSrc}
          alt={cur.alt}
          width={816}
          height={816}
          className="h-full w-full object-contain p-4"
          onError={() => setBroken((b) => ({ ...b, [i]: true }))}
        />
      </div>
      {all.length > 1 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="More images">
          {all.map((g, n) => (
            <li key={`${g.url}-${n}`}>
              <button
                type="button"
                onClick={() => setI(n)}
                aria-label={`Show image ${n + 1} of ${all.length}`}
                aria-current={n === i ? "true" : undefined}
                className={`h-16 w-16 overflow-hidden rounded-lg border bg-muted ${n === i ? "border-gold ring-2 ring-gold" : "border-border"}`}
              >
                <img
                  src={broken[n] ? FALLBACK : g.url}
                  alt=""
                  loading="lazy"
                  width={64}
                  height={64}
                  className="h-full w-full object-contain p-0.5"
                  onError={() => setBroken((b) => ({ ...b, [n]: true }))}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
