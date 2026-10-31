import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Stars } from "@/components/Reviews";
import { WishlistButton } from "@/components/WishlistButton";
import { toast } from "sonner";
import { displayPrice, isPurchasable, type StoreProduct } from "@/lib/storefront";
import { useCart } from "@/lib/cart";
import { useCurrency } from "@/lib/currency";
import { AVAILABILITY_LABEL, PROMO_LABEL } from "@/lib/domain/status";

/** Prefer API image; fall back to static /products/<SKU>.png shipped with the app. */
function resolveImage(p: StoreProduct): string {
  const raw = (p.image || "").trim();
  if (raw && raw !== "/") return raw;
  const sku = p.variantId.includes("::") ? p.variantId.split("::")[1] : "";
  if (sku) return `/products/${sku}.png`;
  return "";
}

const FALLBACK =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="816" height="816" viewBox="0 0 816 816">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#F4F6FA"/><stop offset="100%" stop-color="#DCE2EC"/>
      </linearGradient></defs>
      <rect width="816" height="816" fill="url(#g)"/>
      <circle cx="408" cy="380" r="110" fill="#071D49" opacity="0.1"/>
      <rect x="268" y="520" width="280" height="18" rx="9" fill="#071D49" opacity="0.12"/>
    </svg>`,
  );

export function ProductCard({ p }: { p: StoreProduct }) {
  const { add } = useCart();
  const { mode, rate } = useCurrency();
  const resolved = resolveImage(p);
  const [src, setSrc] = useState(resolved || FALLBACK);
  useEffect(() => {
    setSrc(resolved || FALLBACK);
  }, [resolved]);

  const view = p;
  const price = displayPrice(p, mode, rate);
  const purchasable = isPurchasable(p);
  const cta =
    view.availability === "pre_order"
      ? "Pre-order"
      : view.availability === "coming_soon"
        ? "Coming soon"
        : price.current.length === 0
          ? "Enquire"
          : "Add to cart";
  const variantId = p.variantId;

  return (
    <article className="product-card-3d group flex flex-col overflow-hidden rounded-[var(--radius)] border border-border bg-card shadow-[var(--shadow-card)]">
      <Link
        to="/product/$slug"
        params={{ slug: p.slug }}
        className="product-card-3d-stage relative block aspect-square w-full min-h-[140px] overflow-hidden"
      >
        <span className="product-card-3d-plate" aria-hidden="true" />
        <img
          src={src}
          alt={p.imageAlt || p.name}
          loading="lazy"
          decoding="async"
          width={816}
          height={816}
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          className="product-card-3d-img relative z-[1] mx-auto block h-full w-full max-h-full max-w-full object-contain p-3 sm:p-4"
          onError={() => {
            if (src !== FALLBACK) setSrc(FALLBACK);
          }}
        />
        <span className="absolute left-2 top-2 z-[3] flex flex-wrap gap-1.5 sm:left-3 sm:top-3">
          {view.availability !== "available" && (
            <span className="badge-preorder">{AVAILABILITY_LABEL[view.availability]}</span>
          )}
          {view.labels.map((l) => (
            <span key={l} className="badge-label">
              {PROMO_LABEL[l]}
            </span>
          ))}
        </span>
      </Link>
      <div className="flex flex-1 flex-col p-3 sm:p-4">
        <Link to="/product/$slug" params={{ slug: p.slug }} className="line-clamp-2 text-sm font-medium text-foreground hover:underline sm:text-base">
          {p.name}
        </Link>
        {p.rating && p.rating.count > 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            <Stars value={p.rating.average} /> {p.rating.average} ({p.rating.count})
          </p>
        )}
        <div className="mt-1">
          {price.current.map((c, i) => (
            <div key={c.text} className="flex items-baseline gap-2">
              <span className={i === 0 ? "font-semibold text-primary" : "text-sm text-muted-foreground"}>{c.text}</span>
              {price.original[i] && <span className="text-xs text-muted-foreground line-through">{price.original[i]!.text}</span>}
            </div>
          ))}
          {price.current.length === 0 && <span className="text-sm font-medium text-muted-foreground">Price on request</span>}
        </div>
        <button
          className="btn-secondary mt-3 w-full text-xs sm:mt-4 sm:text-sm disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!purchasable}
          onClick={() => {
            if (!purchasable) return;
            const r = add(variantId);
            if (r.ok) toast(`${p.name} added to cart`);
            else toast.error(r.reason);
          }}
        >
          {purchasable ? cta : AVAILABILITY_LABEL[view.availability]}
        </button>
        <div className="mt-2 text-right">
          <WishlistButton slug={p.slug} name={p.name} />
        </div>
      </div>
    </article>
  );
}
