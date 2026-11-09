import Link from "next/link";
import { bpsToPercent, formatUnits } from "@/lib/format";
import { serverConfig } from "@/lib/config";
import { getConfig, getTokenMeta, listOffers } from "@/lib/near/server";

export const dynamic = "force-dynamic";

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

  return (
    <div className="stack">
      <section className="hero">
        <p className="eyebrow">NEAR HACKATHON · real-world money · agents · autonomous business</p>
        <h1>Businesses pay creators only when a sale happens.</h1>
        <p className="lead">
          Publish an offer with a commission. Every creator gets a unique link. A buyer pays with a
          token they already hold. A NEAR contract escrows the payment and splits it — merchant,
          creator, protocol — after the refund hold. Creators claim their link without buying gas,
          and the agent drafts the commission rules without ever holding a spending key.
        </p>
        <div className="row">
          <Link className="btn" href="/business">
            Open the business console
          </Link>
          <Link className="btn btn-ghost" href="/intents">
            Try a dry Intents quote
          </Link>
          <a className="btn btn-ghost" href="/api/health">
            Health JSON
          </a>
        </div>
      </section>

      {!configured ? (
        <section className="card warn-card">
          <h2>This deployment is not wired to a contract yet</h2>
          <p>
            Set <code>NEAR_CONTRACT_ID</code>, <code>NEAR_FT_ACCOUNT</code> and the rest of{" "}
            <code>.env.example</code>, then restart. The screens still render so you can inspect the
            UI; every contract read returns empty until the env is filled in.
          </p>
          <pre className="code">{`cp .env.example apps/web/.env.local   # fill in testnet ids
npm install
npm run dev        # http://localhost:3000`}</pre>
        </section>
      ) : null}

      <section className="grid grid-3">
        <div className="card">
          <h3>1 · Publish</h3>
          <p className="muted">
            Describe the offer in a sentence. The agent drafts price, commission and refund hold; the
            merchant publishes from their own wallet.
          </p>
        </div>
        <div className="card">
          <h3>2 · Refer</h3>
          <p className="muted">
            Creators claim a code. The claim is a NEP-366 meta-transaction: the relayer pays gas, the
            creator pays nothing.
          </p>
        </div>
        <div className="card">
          <h3>3 · Settle</h3>
          <p className="muted">
            The buyer pays into escrow. After the hold, anyone can call <code>release</code> and the
            contract pays all three parties. Before that, the merchant can refund.
          </p>
        </div>
      </section>

      <section className="stack">
        <div className="section-head">
          <h2>Live offers</h2>
          <span className="muted small">
            {contractConfig
              ? `protocol fee ${bpsToPercent(contractConfig.protocol_fee_bps)} → ${contractConfig.treasury}`
              : "contract not configured"}
          </span>
        </div>
        {offers.length === 0 ? (
          <div className="card muted">
            No offers yet. {configured ? "Publish one from the business console." : "Configure the app to load live offers."}
          </div>
        ) : (
          <div className="grid grid-2">
            {offers.map((offer) => (
              <Link className="card offer-card" href={`/offer/${offer.id}`} key={offer.id}>
                <div className="row-between">
                  <span className="badge">offer #{offer.id}</span>
                  {offer.paused ? <span className="badge badge-warn">paused</span> : <span className="badge badge-ok">live</span>}
                </div>
                <h3>{offer.title}</h3>
                <p className="muted clamp">{offer.description || "No description"}</p>
                <div className="row-between">
                  <strong>
                    {formatUnits(offer.price, decimals)} {symbol}
                  </strong>
                  <span className="muted small">{bpsToPercent(offer.commission_bps)} to creators</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>What NEAR is doing here</h2>
        <ul className="list">
          <li>
            <strong>Escrow + atomic split</strong> in a Rust contract (<code>ft_on_transfer</code> →{" "}
            <code>release</code>), with the fee math asserted in tests.
          </li>
          <li>
            <strong>NEP-366 meta transactions</strong> so a creator&apos;s first action costs no NEAR;
            the relayer only sponsors <code>register_creator</code> on this contract.
          </li>
          <li>
            <strong>NEAR Intents (1Click)</strong> for cross-chain payout quotes. Intents is
            mainnet-only, so the app labels it separately and defaults to <code>dry: true</code>.
          </li>
        </ul>
      </section>
    </div>
  );
}
