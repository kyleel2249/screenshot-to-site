import { Link } from "@tanstack/react-router";
import { useWishlist } from "@/lib/wishlist";

/** Heart button to save or remove a product. Guests are pointed to sign in rather than silently ignored. */
export function WishlistButton({ slug, name }: { slug: string; name: string }) {
  const { has, toggle, status, error } = useWishlist();
  if (status === "guest") return <Link to="/login" className="text-xs underline" aria-label={`Sign in to save ${name}`}>♡ Save</Link>;
  const saved = has(slug);
  return (
    <>
      <button type="button" aria-pressed={saved} aria-label={saved ? `Remove ${name} from saved items` : `Save ${name} for later`} disabled={status === "loading"} onClick={() => void toggle(slug)} className="rounded-full border border-border px-3 py-1 text-xs hover:bg-secondary disabled:opacity-50">
        {saved ? "♥ Saved" : "♡ Save"}
      </button>
      {error && <span role="alert" className="sr-only">{error}</span>}
    </>
  );
}
