import { useState } from "react";
import type { StoreProduct } from "@/lib/storefront";

/** Main image plus approved extra images. Thumbnails are real buttons (keyboard and screen-reader friendly). */
export function ProductGallery({ p }: { p: Pick<StoreProduct, "image" | "imageAlt" | "gallery"> }) {
  const all = [{ url: p.image, alt: p.imageAlt }, ...(p.gallery ?? []).map((g) => ({ url: g.url, alt: g.alt }))];
  const [i, setI] = useState(0);
  const cur = all[Math.min(i, all.length - 1)]!;
  return (
    <div>
      <div className="aspect-square overflow-hidden rounded-2xl border border-border bg-muted">
        <img
          src={cur.url}
          alt={cur.alt}
          width={816}
          height={816}
          className="h-full w-full object-contain p-2"
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
                <img src={g.url} alt="" loading="lazy" width={64} height={64} className="h-full w-full object-contain p-0.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
