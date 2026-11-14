"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Product image for an offer. The URL comes from the offer description, so it is any https
 * image on the web: render a plain <img> without a referrer. If it fails to load, the card
 * variant disappears and the hero and thumb variants keep their box as an empty placeholder,
 * so the surrounding layout does not shift.
 */
export function OfferImage({
  src,
  alt,
  variant = "card",
}: {
  src: string;
  alt: string;
  variant?: "card" | "hero" | "thumb";
}) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  // A server-rendered image can fail before hydration attaches onError. decode() rejects
  // only for a broken image (it waits for lazy or pending loads), so use it to confirm.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) {
      img.decode().catch(() => setFailed(true));
    }
  }, []);

  if (failed) {
    return variant === "card" ? null : (
      <div className={`offer-image offer-image-${variant} offer-image-empty`} aria-hidden="true" />
    );
  }
  return (
    <div className={`offer-image offer-image-${variant}`}>
      <img
        ref={ref}
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
