import { CreatorConsole } from "@/components/creator-console";
import { demoAccount, relayerKeys, serverConfig } from "@/lib/config";
import { listOffers, getTokenMeta } from "@/lib/near/server";

export const dynamic = "force-dynamic";

export default async function CreatorPage() {
  const config = serverConfig();
  const [offers, tokenMeta] = await Promise.all([
    config.contractId ? listOffers(0, 50) : Promise.resolve([]),
    getTokenMeta(),
  ]);

  return (
    <div className="stack">
      <div>
        <h1>Creator links</h1>
        <p className="lead">
          Claim one code per offer. With the relayer configured, the claim is a NEP-366 meta transaction: you sign,
          the relayer pays the gas, and the contract still credits <code>predecessor_account_id</code> — you.
        </p>
      </div>
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
    </div>
  );
}
