import type { Metadata } from "next";
import Link from "next/link";
import { bpsToPercent, formatDate, formatUnits, shortAccount } from "@/lib/format";
import { serverConfig } from "@/lib/config";
import { getConfig, getStats, getTokenMeta, listOffers, listSales } from "@/lib/near/server";
import { explorerAccount } from "@/components/explorer";
import type { SaleStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Activity",
  description: "Every ReferRail offer and sale, settled on-chain and open to verify.",
};

const STATUS_LABEL: Record<SaleStatus, { label: string; className: string }> = {
  Pending: { label: "In refund window", className: "badge-warn" },
  Released: { label: "Paid out", className: "badge-ok" },
  Refunded: { label: "Refunded", className: "badge-danger" },
};

/** Human refund window, e.g. "3 days", "12 hours", "None". */
function refundWindow(ns: number): string {
  if (!ns) return "None";
  const seconds = Math.round(ns / 1_000_000_000);
  const unit = (value: number, name: string) => `${value} ${name}${value === 1 ? "" : "s"}`;
  if (seconds % 86_400 === 0) return unit(seconds / 86_400, "day");
  if (seconds % 3_600 === 0) return unit(seconds / 3_600, "hour");
  if (seconds % 60 === 0) return unit(seconds / 60, "minute");
  return unit(seconds, "second");
}

function AccountLink({ network, account }: { network: string; account: string }) {
  return (
    <a
      className="link mono small"
      href={explorerAccount(network, account)}
      target="_blank"
      rel="noreferrer"
      title={account}
      aria-label={`${account} (opens in block explorer)`}
    >
      {shortAccount(account)}
    </a>
  );
}

export default async function LedgerPage() {
  const config = serverConfig();
  const [offers, sales, contractConfig, stats, tokenMeta] = await Promise.all([
    config.contractId ? listOffers(0, 100) : Promise.resolve([]),
    config.contractId ? listSales(0, 200) : Promise.resolve([]),
    config.contractId ? getConfig() : Promise.resolve(null),
    config.contractId ? getStats() : Promise.resolve(null),
    getTokenMeta(),
  ]);
  const decimals = tokenMeta?.decimals ?? config.tokenDecimals;
  const symbol = tokenMeta?.symbol ?? config.tokenSymbol;
  const network = config.network;
  const available = Boolean(config.contractId) && Boolean(contractConfig);

  // Newest first reads better for an activity feed.
  const recentOffers = [...offers].sort((a, b) => b.id - a.id);
  const recentSales = [...sales].sort((a, b) => b.id - a.id);

  return (
    <div className="stack-lg">
      <header className="page-head">
        <div className="page-head-row">
          <div>
            <p className="eyebrow">Activity</p>
            <h1>Every offer and sale, on the record</h1>
            <p className="lead">
              Every payment is held and settled by a smart contract on NEAR, so each sale and split is recorded
              on-chain. You don&apos;t have to take our word for it: check any account in a block explorer.
            </p>
          </div>
          {config.contractId ? (
            <div className="page-actions">
              <a
                className="btn btn-ghost"
                href={explorerAccount(network, config.contractId)}
                target="_blank"
                rel="noreferrer"
              >
                View contract in explorer
              </a>
            </div>
          ) : null}
        </div>
      </header>

      {!available ? (
        <div className="notice notice-warn" role="status">
          <p className="notice-title">Activity is temporarily unavailable</p>
          <p className="mb-0">We couldn&apos;t reach the network just now. Please try again shortly.</p>
        </div>
      ) : contractConfig?.paused_global ? (
        <div className="notice notice-warn" role="status">
          <p className="notice-title">Payments are paused</p>
          <p className="mb-0">New payments are temporarily paused. Past sales below are unaffected.</p>
        </div>
      ) : null}

      <section aria-label="Totals" className="stats">
        <div className="stat">
          <span className="stat-label">Offers</span>
          <span className="stat-value">{(stats?.offer_count ?? 0).toLocaleString("en-US")}</span>
          <span className="stat-hint">Published to date</span>
        </div>
        <div className="stat">
          <span className="stat-label">Sales</span>
          <span className="stat-value">{(stats?.sale_count ?? 0).toLocaleString("en-US")}</span>
          <span className="stat-hint">All time</span>
        </div>
        <div className="stat">
          <span className="stat-label">Volume</span>
          <span className="stat-value">
            {formatUnits(stats?.volume ?? "0", decimals)}
            <span className="stat-unit">{symbol}</span>
          </span>
          <span className="stat-hint">Total paid by buyers</span>
        </div>
        <div className="stat">
          <span className="stat-label">Service fee</span>
          <span className="stat-value">
            {contractConfig ? bpsToPercent(contractConfig.protocol_fee_bps) : "—"}
          </span>
          <span className="stat-hint">
            {contractConfig ? (contractConfig.paused_global ? "Payments paused" : "Of each sale") : "Unavailable"}
          </span>
        </div>
      </section>

      <section className="stack" aria-labelledby="offers-title">
        <div className="section-head">
          <div>
            <h2 id="offers-title" className="section-title">
              Offers
            </h2>
            <p className="section-lead">What businesses are selling, and what creators earn on each sale.</p>
          </div>
          {recentOffers.length > 0 ? (
            <span className="badge">{recentOffers.length.toLocaleString("en-US")} shown</span>
          ) : null}
        </div>
        {recentOffers.length === 0 ? (
          <div className="empty">
            <h3 className="empty-title">No offers yet</h3>
            <p>Publish an offer and it will appear here as soon as it&apos;s live.</p>
            <div className="row">
              <Link className="btn" href="/business">
                Publish an offer
              </Link>
            </div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Offers, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Offer</th>
                  <th scope="col">Business</th>
                  <th scope="col" className="num">
                    Price
                  </th>
                  <th scope="col" className="num">
                    Creator earns
                  </th>
                  <th scope="col" className="num">
                    Service fee
                  </th>
                  <th scope="col">Refund window</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentOffers.map((offer) => (
                  <tr key={offer.id}>
                    <td>
                      <Link className="link strong" href={`/offer/${offer.id}`}>
                        {offer.title}
                      </Link>
                      <div className="faint xsmall">#{offer.id}</div>
                    </td>
                    <td>
                      <AccountLink network={network} account={offer.merchant} />
                    </td>
                    <td className="num">
                      {formatUnits(offer.price, decimals)} <span className="muted">{symbol}</span>
                    </td>
                    <td className="num">{bpsToPercent(offer.commission_bps)}</td>
                    <td className="num">{bpsToPercent(offer.protocol_fee_bps)}</td>
                    <td>{refundWindow(offer.refund_hold_ns)}</td>
                    <td>
                      <span className={`badge badge-dot ${offer.paused ? "badge-warn" : "badge-ok"}`}>
                        {offer.paused ? "Paused" : "Live"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="stack" aria-labelledby="sales-title">
        <div className="section-head">
          <div>
            <h2 id="sales-title" className="section-title">
              Sales
            </h2>
            <p className="section-lead">
              Each payment is held until its refund window closes, then released and split in one step.
            </p>
          </div>
          {recentSales.length > 0 ? (
            <span className="badge">{recentSales.length.toLocaleString("en-US")} shown</span>
          ) : null}
        </div>
        {recentSales.length === 0 ? (
          <div className="empty">
            <h3 className="empty-title">No sales yet</h3>
            <p>Sales show up here the moment a buyer pays. Share an offer link to get the first one.</p>
            <div className="row">
              <Link className="btn" href="/creator">
                Get a referral link
              </Link>
              <Link className="btn btn-ghost" href="/#offers">
                Browse offers
              </Link>
            </div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Sales, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Sale</th>
                  <th scope="col">Offer</th>
                  <th scope="col">Buyer</th>
                  <th scope="col">Creator</th>
                  <th scope="col" className="num">
                    Amount
                  </th>
                  <th scope="col" className="num">
                    Business gets
                  </th>
                  <th scope="col" className="num">
                    Creator gets
                  </th>
                  <th scope="col" className="num">
                    Service fee
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">Date</th>
                </tr>
              </thead>
              <tbody>
                {recentSales.map((sale) => {
                  const status = STATUS_LABEL[sale.status] ?? { label: sale.status, className: "badge-warn" };
                  return (
                    <tr key={sale.id}>
                      <td className="faint">#{sale.id}</td>
                      <td>
                        <Link className="link" href={`/offer/${sale.offer_id}`}>
                          Offer #{sale.offer_id}
                        </Link>
                      </td>
                      <td>
                        <AccountLink network={network} account={sale.buyer} />
                      </td>
                      <td>
                        {sale.creator ? (
                          <>
                            <AccountLink network={network} account={sale.creator} />
                            {sale.creator_code ? (
                              <div className="faint xsmall">
                                Code <span className="mono">{sale.creator_code}</span>
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <span className="muted small">
                            Direct sale
                            {sale.creator_code ? (
                              <span className="faint xsmall">
                                {" "}
                                · code <span className="mono">{sale.creator_code}</span>
                              </span>
                            ) : null}
                          </span>
                        )}
                      </td>
                      <td className="num strong">
                        {formatUnits(sale.amount, decimals)} <span className="muted">{symbol}</span>
                      </td>
                      <td className="num">{formatUnits(sale.merchant_amount, decimals)}</td>
                      <td className="num">{formatUnits(sale.creator_amount, decimals)}</td>
                      <td className="num">{formatUnits(sale.protocol_amount, decimals)}</td>
                      <td>
                        <span className={`badge badge-dot ${status.className}`}>{status.label}</span>
                      </td>
                      <td className="small muted">{formatDate(sale.created_at_ns)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {recentSales.length > 0 ? (
          <p className="faint xsmall mb-0">Split amounts are in {symbol}. Dates are in UTC.</p>
        ) : null}
      </section>

      {contractConfig ? (
        <details className="details">
          <summary>Technical details</summary>
          <div className="details-body">
            <p>
              Everything on this page is read directly from the escrow contract on NEAR {network}, with no database
              or cached copy in between.
            </p>
            <dl className="kv">
              <dt>Contract</dt>
              <dd className="mono">{config.contractId}</dd>
              <dt>Owner</dt>
              <dd className="mono">{contractConfig.owner}</dd>
              <dt>Fee treasury</dt>
              <dd className="mono">{contractConfig.treasury}</dd>
              <dt>Accepted tokens</dt>
              <dd className="mono">{contractConfig.tokens.join(", ") || "None"}</dd>
              <dt>Service fee</dt>
              <dd>{bpsToPercent(contractConfig.protocol_fee_bps)}</dd>
              <dt>Status</dt>
              <dd>{contractConfig.paused_global ? "Paused" : "Running"}</dd>
            </dl>
          </div>
        </details>
      ) : null}
    </div>
  );
}
