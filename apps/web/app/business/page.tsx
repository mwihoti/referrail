import { BusinessConsole } from "@/components/business-console";
import { demoAccount, serverConfig } from "@/lib/config";
import { getTokenMeta, listOffers, listSales } from "@/lib/near/server";
import type { Sale } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function BusinessPage() {
  const config = serverConfig();
  const [offers, sales, tokenMeta] = await Promise.all([
    config.contractId ? listOffers(0, 50) : Promise.resolve([]),
    config.contractId ? listSales(0, 200) : Promise.resolve([]),
    getTokenMeta(),
  ]);

  const salesByOffer = sales.reduce<Record<number, Sale[]>>((acc, sale) => {
    acc[sale.offer_id] = [...(acc[sale.offer_id] ?? []), sale];
    return acc;
  }, {});

  return (
    <div className="stack">
      <div>
        <h1>Business console</h1>
        <p className="lead">
          Describe the offer. The agent drafts the rules, you review them, and your wallet publishes.
          The agent never holds a key that can move sale funds.
        </p>
      </div>
      <BusinessConsole
        offers={offers}
        salesByOffer={salesByOffer}
        decimals={tokenMeta?.decimals ?? config.tokenDecimals}
        symbol={tokenMeta?.symbol ?? config.tokenSymbol}
        contractId={config.contractId}
        demoMode={config.demoMode}
        demoAccounts={{
          merchant: demoAccount("merchant")?.account ?? null,
          creator: demoAccount("creator")?.account ?? null,
          buyer: demoAccount("buyer")?.account ?? null,
        }}
      />
    </div>
  );
}
