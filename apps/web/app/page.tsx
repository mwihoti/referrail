import Link from "next/link";
import { bpsToPercent, formatUnits } from "@/lib/format";
import { serverConfig } from "@/lib/config";
import { getConfig, getTokenMeta, listOffers } from "@/lib/near/server";
import { explorerAccount } from "@/components/explorer";
import { OfferImage } from "@/components/offer-image";
import { parseOfferDescription } from "@/lib/offer-meta";

export const dynamic = "force-dynamic";

/** Commission used for the worked fee example. */
const EXAMPLE_COMMISSION_BPS = 1000;
const EXAMPLE_SALE = 100;

function formatAmount(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
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
  bolt: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  ),
  globe: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
    </svg>
  ),
};

export default async function HomePage() {
  const config = serverConfig();
  const [offers, contractConfig, tokenMeta] = await Promise.all([
    config.contractId ? listOffers(0, 12) : Promise.resolve([]),
    config.contractId ? getConfig() : Promise.resolve(null),
    getTokenMeta(),
  ]);
  const decimals = tokenMeta?.decimals ?? config.tokenDecimals;
  const symbol = tokenMeta?.symbol ?? config.tokenSymbol;
  const configured = Boolean(config.contractId) && Boolean(contractConfig);
  const testnet = config.network === "testnet";

  const feeBps = contractConfig?.protocol_fee_bps ?? null;
  const example =
    feeBps === null
      ? null
      : (() => {
          const protocol = (EXAMPLE_SALE * feeBps) / 10_000;
          const creator = (EXAMPLE_SALE * EXAMPLE_COMMISSION_BPS) / 10_000;
          const merchant = EXAMPLE_SALE - protocol - creator;
          return { protocol, creator, merchant };
        })();

  return (
    <div className="stack-lg">
      {/* Hero */}
      <section className="hero" aria-labelledby="hero-title">
        <p className="eyebrow">Pay-on-sale referral marketing</p>
        <h1 id="hero-title">
          Pay creators <span className="accent">only when they sell.</span>
        </h1>
        <p className="lead">
          Publish an offer, set a commission, and let creators share it with their audience. Every buyer payment is
          held in escrow and, once the refund window closes, released in a single step that splits it between you
          and the creator. No invoices, no chasing payouts, no paying for clicks that never convert.
        </p>
        <div className="hero-actions">
          <Link className="btn btn-lg" href="/business">
            Start selling
          </Link>
          <Link className="btn btn-ghost btn-lg" href="/creator">
            Earn as a creator
          </Link>
        </div>
      </section>

      {/* Trust strip */}
      <ul className="trust-strip" aria-label="Why ReferRail">
        <li className="trust-item">
          <span className="trust-icon">{icons.shield}</span>
          Escrowed on NEAR
        </li>
        <li className="trust-item">
          <span className="trust-icon">{icons.undo}</span>
          Refund window for buyers
        </li>
        <li className="trust-item">
          <span className="trust-icon">{icons.bolt}</span>
          Low cost for creators
        </li>
        <li className="trust-item">
          <span className="trust-icon">{icons.globe}</span>
          Payouts across chains
        </li>
      </ul>

      {/* How it works */}
      <section className="stack" aria-labelledby="how-title">
        <div className="section-head">
          <div>
            <p className="eyebrow">How it works</p>
            <h2 id="how-title" className="section-title">
              From offer to payout in three steps
            </h2>
          </div>
        </div>
        <ol className="steps">
          <li className="step">
            <h3>Publish an offer</h3>
            <p>
              Describe what you sell in one sentence. Our assistant drafts the price, commission and refund window.
              You review the terms and publish from your own wallet.
            </p>
          </li>
          <li className="step">
            <h3>Creators share their link</h3>
            <p>
              Creators claim a unique referral link in a few seconds and share it with their audience.
            </p>
          </li>
          <li className="step">
            <h3>Everyone gets paid</h3>
            <p>
              Buyers pay into escrow. When the refund window closes, the payment is released and split between
              you, the creator and a small service fee.
            </p>
          </li>
        </ol>
      </section>

      {/* Audiences */}
      <section className="grid grid-2" aria-label="Who ReferRail is for">
        <div className="card audience">
          <div>
            <p className="eyebrow">For businesses</p>
            <h2>Grow sales without paying for reach</h2>
          </div>
          <ul className="check-list">
            <li>
              <strong>Pay only for results.</strong> Commission is taken from completed sales, never from clicks or
              impressions.
            </li>
            <li>
              <strong>Refunds stay in your hands.</strong> Refund a buyer in full at any point before the refund
              window closes.
            </li>
            <li>
              <strong>Launch in minutes.</strong> Describe your offer in a sentence and get a ready-to-publish draft.
            </li>
            <li>
              <strong>Every sale on record.</strong> Payments and splits are public and verifiable.
            </li>
          </ul>
          <Link className="btn" href="/business">
            Start selling
          </Link>
        </div>
        <div className="card audience">
          <div>
            <p className="eyebrow">For creators</p>
            <h2>Get paid for every sale you drive</h2>
          </div>
          <ul className="check-list">
            <li>
              <strong>Your own referral link.</strong> Claim a link for any offer and share it anywhere.
            </li>
            <li>
              <strong>Free to join.</strong> No sign-up fee. Claiming a link costs only a tiny network fee.
            </li>
            <li>
              <strong>Locked-in split.</strong> Your commission is recorded with each sale when the buyer pays and
              paid out by the contract, not by an invoice.
            </li>
            <li>
              <strong>Payouts your way.</strong> Get quotes to receive your earnings on other chains.
            </li>
          </ul>
          <Link className="btn btn-ghost" href="/creator">
            Earn as a creator
          </Link>
        </div>
      </section>

      {/* Live offers */}
      <section className="stack" id="offers" aria-labelledby="offers-title">
        <div className="section-head">
          <div>
            <p className="eyebrow">Marketplace</p>
            <h2 id="offers-title" className="section-title">
              Live offers
            </h2>
            <p className="section-lead">Pick an offer to buy it, or claim a referral link and start earning.</p>
          </div>
          {configured ? (
            <Link className="btn btn-subtle btn-sm" href="/ledger">
              View all activity
            </Link>
          ) : null}
        </div>
        {offers.length > 0 ? (
          <div className="grid grid-3">
            {offers.map((offer) => {
              const meta = parseOfferDescription(offer.description);
              return (
                <Link className="card offer-card" href={`/offer/${offer.id}`} key={offer.id}>
                  {meta.imageUrl ? <OfferImage src={meta.imageUrl} alt={offer.title} variant="card" /> : null}
                  <div className="row-between">
                    <span className="faint xsmall">Offer #{offer.id}</span>
                    {offer.paused ? (
                      <span className="badge badge-warn badge-dot">Paused</span>
                    ) : (
                      <span className="badge badge-ok badge-dot">Live</span>
                    )}
                  </div>
                  <h3>{offer.title}</h3>
                  {meta.storeHost ? <span className="faint xsmall">Links to {meta.storeHost}</span> : null}
                  <p className="muted small clamp">{meta.body || "No description provided."}</p>
                  <div className="row-between offer-meta">
                    <span className="price">
                      {formatUnits(offer.price, decimals)}
                      <span className="price-unit">{symbol}</span>
                    </span>
                    <span className="badge badge-info">{bpsToPercent(offer.commission_bps)} to creators</span>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : configured ? (
          <div className="empty">
            <h3 className="empty-title">No offers yet</h3>
            <p>Be the first to publish one. It takes a sentence to describe and a minute to review.</p>
            <div className="row">
              <Link className="btn" href="/business">
                Publish an offer
              </Link>
            </div>
          </div>
        ) : (
          <div className="empty">
            <h3 className="empty-title">Offers are temporarily unavailable</h3>
            <p>Please try again shortly.</p>
          </div>
        )}
      </section>

      {/* Integrations */}
      <section className="stack" id="integrations" aria-labelledby="integrations-title">
        <div className="section-head">
          <div>
            <p className="eyebrow">Works with</p>
            <h2 id="integrations-title" className="section-title">
              Bring ReferRail to the tools you already use
            </h2>
          </div>
        </div>
        <div className="grid grid-2">
          <div className="card audience integration-card">
            <div>
              <p className="eyebrow">Store</p>
              <h3 className="integration-name">Shopify</h3>
            </div>
            <p className="muted mb-0">
              Paste a link to your Shopify store or product and we fill in the offer for you to review, then add a
              Buy with ReferRail button to its page. Creators share their own link and earn on every sale.
            </p>
            <Link className="btn" href="/business">
              Import a product
            </Link>
          </div>
          <div className="card audience integration-card">
            <div>
              <p className="eyebrow">Referral campaigns</p>
              <h3 className="integration-name">
                <a href="https://www.ubutangaza.biz" target="_blank" rel="noopener noreferrer">
                  Ubu-Tangaza
                </a>
              </h3>
            </div>
            <p className="muted mb-0">
              Ubu-Tangaza helps businesses run referral campaigns: customers bring new customers, the business checks
              the proof. ReferRail is the payment rail for the cash side: point campaign referrers to ReferRail links
              and their commission is escrowed and paid out on chain.
            </p>
            <a className="btn btn-ghost" href="https://www.ubutangaza.biz" target="_blank" rel="noopener noreferrer">
              Visit Ubu-Tangaza
            </a>
          </div>
        </div>
      </section>

      {/* Fees */}
      <section className="card" aria-labelledby="fees-title">
        <div className="fee-grid">
          <div className="stack-sm">
            <p className="eyebrow">Pricing</p>
            <h2 id="fees-title">Simple, transparent fees</h2>
            {feeBps !== null ? (
              <>
                <div className="big-number">{bpsToPercent(feeBps)}</div>
                <p className="muted">
                  service fee per completed sale. No listing fees, no monthly plan, and refunded sales cost nothing.
                  You set the creator commission yourself.
                </p>
              </>
            ) : (
              <p className="muted">
                A small service fee per completed sale, never more than 2%. No listing fees, no monthly plan, and
                refunded sales cost nothing.
              </p>
            )}
          </div>
          {example && feeBps !== null ? (
            <div className="stack-sm">
              <h3>
                Example: a {EXAMPLE_SALE} {symbol} sale with a {bpsToPercent(EXAMPLE_COMMISSION_BPS)} creator
                commission
              </h3>
              <div
                className="splitbar"
                role="img"
                aria-label={`Seller ${formatAmount(example.merchant)}, creator ${formatAmount(example.creator)}, service fee ${formatAmount(example.protocol)} ${symbol}`}
              >
                <span className="splitbar-seg seg-merchant" style={{ width: `${example.merchant}%` }} />
                <span className="splitbar-seg seg-creator" style={{ width: `${example.creator}%` }} />
                <span className="splitbar-seg seg-protocol" style={{ width: `${example.protocol}%` }} />
              </div>
              <ul className="legend">
                <li>
                  <span className="legend-swatch seg-merchant" aria-hidden="true" />
                  Seller <strong>{formatAmount(example.merchant)} {symbol}</strong>
                </li>
                <li>
                  <span className="legend-swatch seg-creator" aria-hidden="true" />
                  Creator <strong>{formatAmount(example.creator)} {symbol}</strong>
                </li>
                <li>
                  <span className="legend-swatch seg-protocol" aria-hidden="true" />
                  Service fee <strong>{formatAmount(example.protocol)} {symbol}</strong>
                </li>
              </ul>
              {contractConfig ? (
                <details className="details mt-3">
                  <summary>Technical details</summary>
                  <div className="details-body">
                    <p>
                      The split is calculated and paid by a smart contract on NEAR. Both the creator commission and the
                      service fee are taken from the sale amount; the rest goes to the seller.
                    </p>
                    <p>
                      Service fees are paid to <span className="mono">{contractConfig.treasury}</span>.
                    </p>
                    <p>
                      Claims made without a wallet can be sent as sponsored transactions, so the network fee is
                      covered by the app.
                      Cross-chain payout quotes come from NEAR Intents and are estimates until you confirm them.
                    </p>
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      {/* FAQ */}
      <section className="stack" aria-labelledby="faq-title">
        <div className="section-head">
          <div>
            <p className="eyebrow">FAQ</p>
            <h2 id="faq-title" className="section-title">
              Questions, answered
            </h2>
          </div>
        </div>
        <div className="faq">
          <details>
            <summary>Is my money safe?</summary>
            <div className="details-body">
              <p>
                Buyer payments are held by a public smart contract on NEAR, not by ReferRail. The contract only pays
                out according to the offer&apos;s terms: the full amount back to the buyer on a refund, or the agreed
                split once the refund window closes.
                {config.contractId ? (
                  <>
                    {" "}
                    You can{" "}
                    <a href={explorerAccount(config.network, config.contractId)} target="_blank" rel="noreferrer">
                      inspect the contract
                    </a>{" "}
                    at any time.
                  </>
                ) : null}
              </p>
              {testnet ? (
                <p>ReferRail is currently running on the NEAR test network, so only test tokens are involved.</p>
              ) : null}
            </div>
          </details>
          <details>
            <summary>What happens if a buyer asks for a refund?</summary>
            <div className="details-body">
              <p>
                Each offer has a refund window. Until it closes, the business can refund the buyer in full and nobody
                is charged a commission or fee. After the window closes, the payment is split and paid out.
              </p>
            </div>
          </details>
          <details>
            <summary>Do creators need crypto?</summary>
            <div className="details-body">
              <p>
                Creators need a NEAR account to receive earnings. They don&apos;t need to buy the offer&apos;s token,
                just enough NEAR to cover a tiny network fee when they claim a link.
              </p>
            </div>
          </details>
          <details>
            <summary>Which tokens are supported?</summary>
            <div className="details-body">
              <p>
                Offers are priced in {symbol}
                {testnet ? ", a test stablecoin used on the test network" : ""}. Creators can also request quotes to
                receive their earnings on other chains.
              </p>
            </div>
          </details>
          <details>
            <summary>What does it cost?</summary>
            <div className="details-body">
              <p>
                {feeBps !== null
                  ? `A ${bpsToPercent(feeBps)} service fee on each completed sale.`
                  : "A small service fee on each completed sale."}{" "}
                There are no listing fees or subscriptions. Businesses pay a small NEAR network fee when they publish
                an offer; claiming a referral link costs creators only a tiny network fee.
              </p>
            </div>
          </details>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="cta-band" aria-labelledby="cta-title">
        <div>
          <h2 id="cta-title">Turn creators into your sales team</h2>
          <p>Publish your first offer in minutes and pay only when it sells.</p>
        </div>
        <div className="row">
          <Link className="btn btn-lg" href="/business">
            Start selling
          </Link>
          <Link className="btn btn-ghost btn-lg" href="/creator">
            Earn as a creator
          </Link>
        </div>
      </section>
    </div>
  );
}
