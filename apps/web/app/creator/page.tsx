import type { Metadata } from "next";
import { CreatorConsole } from "@/components/creator-console";
import { demoAccount, relayerKeys, serverConfig } from "@/lib/config";
import { listOffers, getTokenMeta } from "@/lib/near/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "For creators",
  description:
    "Claim a referral link for any ReferRail offer, share it with your audience and earn a commission on every sale you refer.",
};

export default async function CreatorPage() {
  const config = serverConfig();
  const [offers, tokenMeta] = await Promise.all([
    config.contractId ? listOffers(0, 50) : Promise.resolve([]),
    getTokenMeta(),
  ]);

  return (
    <div className="stack-lg">
      <header className="page-head">
        <p className="eyebrow">For creators</p>
        <h1>Earn a commission on every sale you refer</h1>
        <p className="lead">
          Pick an offer, claim your code and share your link. When a sale you referred completes, your commission is
          paid to you when the sale is released. No invoices, no chasing payments.
        </p>
      </header>

      <CreatorConsole
        offers={offers.map((offer) => ({
          id: offer.id,
          title: offer.title,
          commission_bps: offer.commission_bps,
          paused: offer.paused,
        }))}
        contractId={config.contractId}
        decimals={tokenMeta?.decimals ?? config.tokenDecimals}
        symbol={tokenMeta?.symbol ?? config.tokenSymbol}
        demoMode={config.demoMode}
        demoCreator={demoAccount("creator")?.account ?? null}
        relayerConfigured={Boolean(relayerKeys())}
      />

      <section className="stack" aria-labelledby="how-title">
        <div className="section-head">
          <div>
            <h2 id="how-title" className="section-title">
              How you get paid
            </h2>
          </div>
        </div>
        <ol className="steps">
          <li className="step">
            <h3>Claim your code</h3>
            <p>Choose an offer and a short code. Your link is tied to your account, so every sale is credited to you.</p>
          </li>
          <li className="step">
            <h3>Share your link</h3>
            <p>Post it wherever your audience is. Buyers who use it pay through a secure checkout.</p>
          </li>
          <li className="step">
            <h3>Get paid</h3>
            <p>
              Each payment is held safely until the business&apos;s refund window closes, then the payout is released
              and your commission goes straight to you.
            </p>
          </li>
        </ol>

        <details className="details">
          <summary>Technical details</summary>
          <div className="details-body">
            <p>
              Claiming a link registers your code with the ReferRail contract on NEAR. The contract records the
              account that signed the claim as the owner of the code, so commissions can only go to you.
            </p>
            <p>
              Buyer payments are held by the contract, not by ReferRail. Once the refund window ends, the sale can be
              released and the contract splits the payment between the business, you and a small service fee in a single step.
            </p>
            {config.demoMode && relayerKeys() ? (
              <p>
                Claims made with the sandbox account are sent as sponsored transactions (NEP-366 meta transactions), so
                the network fee is covered by the app.
              </p>
            ) : null}
          </div>
        </details>
      </section>
    </div>
  );
}
