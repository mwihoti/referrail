import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { OfferImage } from "@/components/offer-image";
import { PayPanel } from "@/components/pay-panel";
import { refundWindowLabel } from "@/components/offer-format";
import styles from "@/components/offer.module.css";
import { demoAccount, serverConfig } from "@/lib/config";
import { bpsToPercent, formatUnits } from "@/lib/format";
import { parseOfferDescription } from "@/lib/offer-meta";
import { getOffer, getTokenMeta, previewSplit } from "@/lib/near/server";

export const dynamic = "force-dynamic";

/** Shared between generateMetadata and the page so the offer is fetched once per request. */
const loadOffer = cache((offerId: number) => getOffer(offerId));

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const offerId = Number(id);
  if (!Number.isInteger(offerId) || offerId < 1) return { title: "Offer not found" };
  const offer = await loadOffer(offerId).catch(() => null);
  if (!offer) return { title: "Offer not found" };
  const meta = parseOfferDescription(offer.description);
  const body = meta.body.replace(/\s+/g, " ").trim();
  const description =
    (body.length > 300 ? `${body.slice(0, 297).trimEnd()}…` : body) ||
    `Buy ${offer.title} with buyer protection on ReferRail.`;
  const images = meta.imageUrl ? [{ url: meta.imageUrl, alt: offer.title }] : undefined;
  return {
    title: offer.title,
    description,
    openGraph: { title: offer.title, description, ...(images ? { images } : {}) },
    twitter: {
      title: offer.title,
      description,
      ...(meta.imageUrl ? { card: "summary_large_image" as const, images: [meta.imageUrl] } : {}),
    },
  };
}

const icons = {
  shield: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
  undo: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 010 11H11" />
    </svg>
  ),
  people: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0113 0" />
      <path d="M16 4.5a3.5 3.5 0 010 7M18 14.5a6.5 6.5 0 013.5 5.5" />
    </svg>
  ),
};

export default async function OfferPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ref?: string }>;
}) {
  const { id } = await params;
  const { ref } = await searchParams;
  const offerId = Number(id);
  if (!Number.isInteger(offerId) || offerId < 1) notFound();

  const config = serverConfig();
  const [offer, tokenMeta] = await Promise.all([loadOffer(offerId), getTokenMeta()]);
  if (!offer) notFound();

  const refCode = typeof ref === "string" ? ref.slice(0, 32) : "";
  const preview = await previewSplit(offerId, offer.price, refCode || null);

  const decimals = tokenMeta?.decimals ?? config.tokenDecimals;
  const symbol = tokenMeta?.symbol ?? config.tokenSymbol;
  const refundWindow = refundWindowLabel(offer.refund_hold_ns);
  const creatorBps = preview && preview.known_creator ? preview.creator_bps : offer.commission_bps;
  const creatorPercent = bpsToPercent(creatorBps);
  const showReferrer = Boolean(refCode) && (!preview || preview.known_creator);
  const meta = parseOfferDescription(offer.description);

  return (
    <div className="stack-lg">
      <header className={`page-head${meta.imageUrl ? " checkout-head-media" : ""}`}>
        {meta.imageUrl ? <OfferImage src={meta.imageUrl} alt={offer.title} variant="hero" /> : null}
        <div className="checkout-head-text">
          <p className="eyebrow">Checkout</p>
          <h1>{offer.title}</h1>
          {meta.body ? <p className="lead pre-line">{meta.body}</p> : null}
          <div className={styles.headMeta}>
            <p className={styles.headPrice}>
              {formatUnits(offer.price, decimals)}
              <span className="price-unit">{symbol}</span>
            </p>
            {showReferrer ? (
              <span className="badge badge-info">
                Referred by <span className="mono">{refCode}</span>
              </span>
            ) : null}
            {meta.storeUrl && meta.storeHost ? (
              <>
                <span className="badge">Store link · {meta.storeHost}</span>
                <a className="link small" href={meta.storeUrl} target="_blank" rel="noopener noreferrer">
                  View on store
                </a>
              </>
            ) : null}
          </div>
          <p className="small muted mb-0">
            Seller account <span className="mono">{offer.merchant}</span>
            {offer.payout_account && offer.payout_account !== offer.merchant ? (
              <>
                {" "}· paid to <span className="mono">{offer.payout_account}</span>
              </>
            ) : null}
          </p>
        </div>
      </header>

      <ul className="trust-strip" aria-label="Buyer protection">
        <li className="trust-item">
          <span className="trust-icon">{icons.shield}</span>
          <span>{refundWindow ? "Held in escrow until the refund window ends" : "Held in escrow until the sale settles"}</span>
        </li>
        <li className="trust-item">
          <span className="trust-icon">{icons.undo}</span>
          <span>{refundWindow ? `Refundable by the seller for ${refundWindow}` : "No refund window on this offer"}</span>
        </li>
        <li className="trust-item">
          <span className="trust-icon">{icons.people}</span>
          <span>
            {showReferrer ? `Your creator earns ${creatorPercent} of this sale` : `Creators earn ${creatorPercent} of referred sales`}
          </span>
        </li>
      </ul>

      <div className={styles.layout}>
        <PayPanel
          offer={offer}
          preview={preview}
          initialRef={refCode}
          decimals={decimals}
          symbol={symbol}
          contractId={config.contractId}
          ftAccount={config.ftAccount}
          treasury={config.treasuryAccount}
          demoMode={config.demoMode}
          demoBuyer={demoAccount("buyer")?.account ?? null}
        />

        <aside className={styles.aside} aria-labelledby="protection-title">
          <div>
            <h2 id="protection-title" className="section-title">
              How your payment is protected
            </h2>
          </div>
          <ol className="steps steps-vertical">
            <li className="step">
              <h3>You pay into escrow</h3>
              <p>
                Your payment is held securely rather than sent straight to the seller, and it&apos;s credited to the
                creator who referred you.
              </p>
            </li>
            <li className="step">
              <h3>Refund window</h3>
              <p>
                {refundWindow
                  ? `For ${refundWindow} after you pay, the seller can refund you in full.`
                  : "This offer has no refund window, so your payment can be paid out as soon as it's confirmed."}
              </p>
            </li>
            <li className="step">
              <h3>Payout</h3>
              <p>
                {refundWindow ? "When the window closes, your" : "Your"} payment can be released, and it is split
                between the seller, the creator and a small service fee in a single step.
              </p>
            </li>
          </ol>

          <details className="details">
            <summary>Technical details</summary>
            <div className="details-body">
              <p>
                Payments are made in {symbol}, a NEP-141 fungible token
                {config.ftAccount ? (
                  <>
                    {" "}
                    issued by <span className="mono">{config.ftAccount}</span>
                  </>
                ) : null}
                . Checkout sends it to the escrow contract
                {config.contractId ? (
                  <>
                    {" "}
                    <span className="mono">{config.contractId}</span>
                  </>
                ) : null}{" "}
                with <code>ft_transfer_call</code>, and the referral code travels in the transfer message.
              </p>
              <p>
                While a sale is pending the seller can refund it. Once the hold ends, <code>release</code> pays the
                seller, the creator and the service fee in one transaction. Anyone can call it, so the buyer, the
                seller or the creator can release a payout once the hold ends. When you click Release payout, this
                site covers the network fee.
              </p>
              <p>Offer ID: {offer.id}</p>
            </div>
          </details>

          <p className="muted small">
            Selling something yourself?{" "}
            <Link className="link" href="/business">
              Publish an offer
            </Link>
          </p>
        </aside>
      </div>
    </div>
  );
}
