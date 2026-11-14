"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";

const BUTTON_STYLE_CSS =
  "display:inline-block;padding:12px 22px;border-radius:10px;background:#7cf3b3;color:#08130d;font:600 16px/1.2 system-ui,sans-serif;text-decoration:none";

const BUTTON_STYLE: CSSProperties = {
  display: "inline-block",
  padding: "12px 22px",
  borderRadius: 10,
  background: "#7cf3b3",
  color: "#08130d",
  font: "600 16px/1.2 system-ui,sans-serif",
  textDecoration: "none",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const noopSubscribe = () => () => {};

/** Read the site origin on the client only, so the server render and hydration agree. */
function useOrigin(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => "",
  );
}

/** Collapsed "Add a Buy button to your store" panel with a live preview and a copyable HTML snippet. */
export function BuyButtonSnippet({ offerId, price, symbol }: { offerId: number; price: string; symbol: string }) {
  const origin = useOrigin();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const href = `${origin}/offer/${offerId}`;
  const label = `Buy with ReferRail · ${price} ${symbol}`;
  const snippet = origin
    ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" style="${BUTTON_STYLE_CSS}">${escapeHtml(label)}</a>`
    : "";

  async function copy() {
    if (!snippet) return;
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(snippet);
      setCopyState("copied");
      timer.current = setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      textareaRef.current?.focus();
      textareaRef.current?.select();
      setCopyState("manual");
    }
  }

  return (
    <details className="details">
      <summary>Add a Buy button to your store</summary>
      <div className="details-body stack-sm">
        <div className="buy-preview" role="group" aria-label="Button preview">
          <a href={`/offer/${offerId}`} target="_blank" rel="noopener" style={BUTTON_STYLE}>
            {label}
          </a>
        </div>
        <div className="field">
          <label htmlFor={`snippet-${offerId}`}>HTML snippet</label>
          <textarea
            id={`snippet-${offerId}`}
            ref={textareaRef}
            className="mono snippet"
            rows={4}
            readOnly
            value={snippet || "Loading…"}
            onFocus={(event) => event.currentTarget.select()}
            aria-describedby={`snippet-${offerId}-hint`}
          />
          <p className="field-hint" id={`snippet-${offerId}-hint`}>
            Paste this into a Shopify product description (switch the editor to HTML) or a Custom Liquid block.
            Sales through this button have no referrer. Creators share their own referral link from the Creators page.
          </p>
        </div>
        <div className="row">
          <button type="button" className="btn btn-sm" onClick={copy} disabled={!snippet}>
            {copyState === "copied" ? "Copied" : "Copy snippet"}
          </button>
          {copyState === "manual" ? (
            <span className="muted small">Your browser blocked copying. The snippet is selected; copy it by hand.</span>
          ) : null}
        </div>
      </div>
    </details>
  );
}
