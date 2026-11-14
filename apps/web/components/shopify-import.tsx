"use client";

import { useState, type FormEvent } from "react";
import { OfferImage } from "@/components/offer-image";

export interface ImportedProduct {
  title: string;
  description: string;
  price: string;
  imageUrl: string | null;
  productUrl: string;
  handle: string;
}

type ImportResponse =
  | { ok: true; store: string; products: ImportedProduct[] }
  | { ok: false; error: string };

/** Pull products from a public Shopify store and hand one back to the offer form. */
/** Accept bare domains ("shop.myshopify.com") and upgrade http:// links to https://. */
function normaliseStoreLink(raw: string): string {
  const input = raw.trim();
  if (!input) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) return input.replace(/^http:\/\//i, "https://");
  return `https://${input.replace(/^\/\//, "")}`;
}

export function ShopifyImport({
  onUse,
  disabled = false,
  symbol,
}: {
  onUse: (product: ImportedProduct, store: string) => void;
  disabled?: boolean;
  symbol: string;
}) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ store: string; products: ImportedProduct[] } | null>(null);
  const [usedHandle, setUsedHandle] = useState<string | null>(null);

  async function runImport(event?: FormEvent) {
    event?.preventDefault();
    const target = normaliseStoreLink(url);
    if (!target) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setUsedHandle(null);
    try {
      const response = await fetch(`/api/import/shopify?url=${encodeURIComponent(target)}`, { cache: "no-store" });
      let payload: ImportResponse | null = null;
      try {
        payload = (await response.json()) as ImportResponse;
      } catch {
        payload = null;
      }
      if (!payload || !payload.ok) {
        throw new Error(
          payload && !payload.ok && payload.error
            ? payload.error
            : "We couldn't import from that link. Check it and try again.",
        );
      }
      if (payload.products.length === 0) {
        throw new Error("That store has no published products we can import.");
      }
      setResult({ store: payload.store, products: payload.products });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "We couldn't import from that link.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card stack" aria-labelledby="shopify-import-title">
      <div className="card-head mb-0">
        <div>
          <p className="eyebrow">Or start from your store</p>
          <h2 id="shopify-import-title">Import from Shopify</h2>
          <p className="muted small mt-2 mb-0">
            Paste a store or product link. We fill in the title, description, price and image for you to review.
          </p>
        </div>
      </div>

      <form className="field" onSubmit={runImport}>
        <label htmlFor="shopify-url">Store or product link</label>
        <div className="input-row">
          <input
            id="shopify-url"
            type="text"
            inputMode="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="your-store.myshopify.com or a product link"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="shopify-url-hint"
          />
          <button type="submit" className="btn" disabled={loading || disabled || url.trim().length < 4}>
            {loading ? "Importing…" : "Import"}
          </button>
        </div>
        <p className="field-hint" id="shopify-url-hint">
          The store must not be password-protected. Otherwise, enter the details by hand.
        </p>
      </form>

      {error ? (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      ) : null}

      <p className={loading ? "loading mb-0" : result ? "small muted mb-0" : "sr-only"} role="status" aria-live="polite">
        {loading ? (
          "Fetching products…"
        ) : result ? (
          <>
            {result.products.length === 1 ? "1 product" : `${result.products.length} products`} from{" "}
            <span className="mono">{result.store}</span>
          </>
        ) : null}
      </p>

      {result ? (
        <div className="stack-sm">
          <ul className="import-list">
            {result.products.map((product) => (
              <li className="import-item" key={product.handle}>
                {product.imageUrl ? (
                  <OfferImage src={product.imageUrl} alt={product.title} variant="thumb" />
                ) : (
                  <div className="offer-image offer-image-thumb offer-image-empty" aria-hidden="true" />
                )}
                <div className="import-item-body">
                  <p className="import-item-title">{product.title}</p>
                  <p className="small muted mb-0 num">Store price {product.price}</p>
                </div>
                <button
                  type="button"
                  className={usedHandle === product.handle ? "btn btn-sm" : "btn btn-ghost btn-sm"}
                  onClick={() => {
                    setUsedHandle(product.handle);
                    onUse(product, result.store);
                  }}
                  disabled={disabled}
                >
                  {usedHandle === product.handle ? "Using this product" : "Use this product"}
                </button>
              </li>
            ))}
          </ul>
          <p className="field-hint mb-0">
            Store prices are copied as they are, without currency conversion. Check the amount in {symbol} before
            publishing.
          </p>
        </div>
      ) : null}
    </section>
  );
}
