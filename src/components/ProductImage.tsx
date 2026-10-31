import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { PLACEHOLDER_IMAGE, imageSrc, isExternalImage } from "@/lib/storefront";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "onError"> & { src: string | null | undefined };

/**
 * Every product picture goes through here so a bad link never shows as an empty box:
 *  - the stored value is cleaned up first (see `imageSrc`);
 *  - pictures hosted elsewhere are requested without a Referer, which fixes hosts that refuse "hotlinked" images;
 *  - an empty value, or an image that fails to load (including one that failed before the page finished loading), shows a neutral placeholder.
 */
export function ProductImage({ src, alt, ...rest }: Props) {
  const clean = imageSrc(src);
  const [failed, setFailed] = useState("");
  const ref = useRef<HTMLImageElement>(null);
  const bad = !clean || failed === clean;
  // The server-rendered <img> can fail before React attaches onError; catch that case once the component is live.
  useEffect(() => {
    const el = ref.current;
    if (el && clean && el.complete && el.naturalWidth === 0) setFailed(clean);
  }, [clean]);
  return (
    <img
      {...rest}
      ref={ref}
      src={bad ? PLACEHOLDER_IMAGE : clean}
      alt={alt ?? ""}
      {...(!bad && isExternalImage(clean) ? { referrerPolicy: "no-referrer" as const } : {})}
      onError={() => { if (!bad) setFailed(clean); }}
    />
  );
}
