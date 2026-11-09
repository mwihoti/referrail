import { bpsToPercent, formatDate, formatUnits, holdLabel } from "@/lib/format";
import { serverConfig } from "@/lib/config";
import { getConfig, getStats, getTokenMeta, listOffers, listSales } from "@/lib/near/server";

export const dynamic = "force-dynamic";

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

  return (
    <div className="stack">
      <div>
        <h1>Public ledger</h1>
        <p className="lead">
          Everything below is read straight from the contract&apos;s view methods. No database, no cached copy: what
          you see is chain state.
        </p>
      </div>

      <section className="grid grid-3">
        <div className="card">
          <span className="muted small">Offers</span>
          <h2>{stats?.offer_count ?? 0}</h2>
        </div>
        <div className="card">
          <span className="muted small">Sales</span>
          <h2>{stats?.sale_count ?? 0}</h2>
        </div>
        <div className="card">
          <span className="muted small">Volume</span>
          <h2>
            {formatUnits(stats?.volume ?? "0", decimals)} {symbol}
          </h2>
        </div>
      </section>

      <section className="card stack">
        <div className="row-between">
          <h2>Protocol</h2>
          <span className="muted small">
            {contractConfig
              ? `fee ${bpsToPercent(contractConfig.protocol_fee_bps)} · treasury ${contractConfig.treasury} · ${
                  contractConfig.paused_global ? "paused" : "running"
                }`
              : "not configured"}
          </span>
        </div>
        {contractConfig ? (
          <p className="muted small">
            owner <span className="mono">{contractConfig.owner}</span> · whitelisted tokens{" "}
            <span className="mono">{contractConfig.tokens.join(", ") || "none"}</span>
          </p>
        ) : null}
      </section>

      <section className="card stack">
        <h2>Offers</h2>
        {offers.length === 0 ? (
          <p className="muted small">No offers on this contract yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Title</th>
                  <th>Merchant</th>
                  <th>Price</th>
                  <th>Creator</th>
                  <th>Protocol</th>
                  <th>Hold</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {offers.map((offer) => (
                  <tr key={offer.id}>
                    <td className="mono">{offer.id}</td>
                    <td>
                      <a href={`/offer/${offer.id}`}>{offer.title}</a>
                    </td>
                    <td className="mono small">{offer.merchant}</td>
                    <td>
                      {formatUnits(offer.price, decimals)} {symbol}
                    </td>
                    <td>{bpsToPercent(offer.commission_bps)}</td>
                    <td>{bpsToPercent(offer.protocol_fee_bps)}</td>
                    <td>{holdLabel(offer.refund_hold_ns)}</td>
                    <td>
                      <span className={`badge ${offer.paused ? "badge-warn" : "badge-ok"}`}>
                        {offer.paused ? "paused" : "live"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card stack">
        <h2>Sales</h2>
        {sales.length === 0 ? (
          <p className="muted small">No sales recorded yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Offer</th>
                  <th>Buyer</th>
                  <th>Creator / code</th>
                  <th>Amount</th>
                  <th>Merchant / creator / protocol</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <tr key={sale.id}>
                    <td className="mono">{sale.id}</td>
                    <td>#{sale.offer_id}</td>
                    <td className="mono small">{sale.buyer}</td>
                    <td className="mono small">
                      {sale.creator ?? "—"}
                      {sale.creator_code ? <span className="muted"> · {sale.creator_code}</span> : null}
                    </td>
                    <td>{formatUnits(sale.amount, decimals)}</td>
                    <td className="small">
                      {formatUnits(sale.merchant_amount, decimals)} / {formatUnits(sale.creator_amount, decimals)} /{" "}
                      {formatUnits(sale.protocol_amount, decimals)}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          sale.status === "Released" ? "badge-ok" : sale.status === "Refunded" ? "badge-danger" : "badge-warn"
                        }`}
                      >
                        {sale.status}
                      </span>
                    </td>
                    <td className="small muted">{formatDate(sale.created_at_ns)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
