import type { Metadata } from "next";
import { IntentsPanel } from "@/components/intents-panel";
import { serverConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Payouts",
  description: "Route your ReferRail earnings to the chain and token you already use, powered by NEAR Intents.",
};

export default function IntentsPage() {
  const config = serverConfig();
  const testnet = config.network === "testnet";
  return (
    <div className="stack-lg">
      <header className="page-head">
        <p className="eyebrow">Payouts</p>
        <h1>Get paid on the chain you use</h1>
        <p className="lead">
          Your share of every sale can be routed to another chain and token through NEAR Intents, so you get paid
          where you already hold funds. Estimates on this page are for planning only: no funds move
          {config.confirmLiveIntents ? " unless you switch on live mode." : "."}
        </p>
      </header>

      {testnet ? (
        <div className="notice notice-info">
          <p className="notice-title">Estimates use live mainnet prices</p>
          <p className="mb-0">
            Sales on this site use test tokens, which can&apos;t be routed to other chains. Use the estimate below to
            see what a real payout would look like.
          </p>
        </div>
      ) : null}

      <IntentsPanel liveAllowed={config.confirmLiveIntents} jwtConfigured={Boolean(config.intentsJwt)} />

      <section className="stack" aria-labelledby="how-title">
        <div className="section-head">
          <div>
            <h2 id="how-title" className="section-title">
              How cross-chain payouts work
            </h2>
            <p className="section-lead">Your earnings settle first, then travel to wherever you want them.</p>
          </div>
        </div>
        <ol className="steps">
          <li className="step">
            <h3>The sale settles</h3>
            <p>
              Once the refund window closes, the payment is split between the business, the creator and the service
              fee. Each share is paid out on its own.
            </p>
          </li>
          <li className="step">
            <h3>You choose a destination</h3>
            <p>Pick the chain and token you want to receive, and the address that should receive it.</p>
          </li>
          <li className="step">
            <h3>NEAR Intents delivers it</h3>
            <p>
              Independent market makers compete to fill the route at the best available rate. If a route can&apos;t
              complete, the funds go back to your refund address.
            </p>
          </li>
        </ol>
        <details className="details">
          <summary>Technical details</summary>
          <div className="details-body">
            <p>
              Routing uses the NEAR Intents 1Click API, which runs on mainnet only. Estimates are requested as
              &quot;dry&quot; quotes: the route is validated and priced, but no deposit address is created.
            </p>
            <p>
              A three-way split isn&apos;t a single intent. The escrow contract settles the split first, then each
              party&apos;s share can be routed onward independently.
            </p>
            <p>
              The list of chains and tokens comes from the live 1Click token list (<code>GET /v0/tokens</code>), so
              newly supported assets appear automatically.
            </p>
            <p>
              Requests without a partner key are charged a small extra routing fee by 1Click (around 0.2–0.25%).
            </p>
          </div>
        </details>
      </section>
    </div>
  );
}
