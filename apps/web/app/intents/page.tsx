import { IntentsPanel } from "@/components/intents-panel";
import { serverConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function IntentsPage() {
  const config = serverConfig();
  return (
    <div className="stack">
      <div>
        <h1>Cross-chain payouts via NEAR Intents</h1>
        <p className="lead">
          The judged core runs on NEAR testnet. This screen is the mainnet rail that lets a merchant or creator
          receive on the chain they already use. Intents has no testnet, so quotes are <strong>dry</strong> by
          default: they validate and price a route without creating a deposit address.
        </p>
      </div>
      <IntentsPanel liveAllowed={config.confirmLiveIntents} jwtConfigured={Boolean(config.intentsJwt)} />
      <section className="card">
        <h3>Why this is a separate screen</h3>
        <ul className="list">
          <li>1Click (the Intents distribution channel) is mainnet-only — there is no testnet to point the escrow demo at.</li>
          <li>A three-way split is not one atomic intent: the contract settles the split, then each party&apos;s share can be routed onward.</li>
          <li>Tokens and chains come from the live <code>GET /v0/tokens</code> response, never a hard-coded list.</li>
        </ul>
      </section>
    </div>
  );
}
