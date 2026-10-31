import { useState } from "react";
import type { StoreProduct } from "@/lib/storefront";

/** Main image plus approved extra images. Thumbnails are real buttons (keyboard and screen-reader friendly); illustrations are always labelled. */
export function ProductGallery({ p }: { p: Pick<StoreProduct, "image" | "imageAlt" | "gallery" | "illustrative"> }) {
  const all = [{ url: p.image, alt: p.imageAlt, illustrative: !!p.illustrative }, ...(p.gallery ?? [])];
  const [i, setI] = useState(0);
  const cur = all[Math.min(i, all.length - 1)]!;
  return (
    <div>
      <img src={cur.url} alt={cur.alt} width={816} height={816} className="w-full rounded-2xl border border-border object-cover" />
      {cur.illustrative && <p className="mt-2 text-xs text-muted-foreground">Illustrative image — the item you receive may look slightly different.</p>}
      {all.length > 1 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="More images">
          {all.map((g, n) => (
            <li key={g.url}>
              <button type="button" onClick={() => setI(n)} aria-label={`Show image ${n + 1} of ${all.length}`} aria-current={n === i} className={`h-16 w-16 overflow-hidden rounded-lg border ${n === i ? "border-gold ring-2 ring-gold" : "border-border"}`}>
                <img src={g.url} alt="" loading="lazy" width={64} height={64} className="h-full w-full object-cover" />
              </button>
            </li>))}
        </ul>)}
    </div>
  );
}
