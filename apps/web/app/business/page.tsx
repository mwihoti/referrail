import type { Metadata } from "next";
import { BusinessConsole } from "@/components/business-console";
import { demoAccount, serverConfig } from "@/lib/config";
import { getConfig, getTokenMeta, listOffers, listSales } from "@/lib/near/server";
import type { Sale } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "For businesses",
  description:
    "Publish a referral offer in minutes, set the creator commission and pay only on completed sales after the refund window.",
};

export default async function BusinessPage() {
  const config = serverConfig();
  const [offers, sales, tokenMeta, contractConfig] = await Promise.all([
    config.contractId ? listOffers(0, 50) : Promise.resolve([]),
    config.contractId ? listSales(0, 200) : Promise.resolve([]),
    getTokenMeta(),
    config.contractId ? getConfig() : Promise.resolve(null),
  ]);

  const salesByOffer = sales.reduce<Record<number, Sale[]>>((acc, sale) => {
    acc[sale.offer_id] = [...(acc[sale.offer_id] ?? []), sale];
    return acc;
  }, {});

  return (
    <div className="stack-lg">
      <header className="page-head">
        <p className="eyebrow">For businesses</p>
        <h1>Launch a referral offer in minutes</h1>
        <p className="lead">
          Describe what you sell in one sentence. The assistant suggests the terms, you review and publish, and
          creators start sharing. You only pay commission on completed sales, after the refund window closes.
        </p>
      </header>
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
        protocolFeeBps={contractConfig?.protocol_fee_bps ?? null}
      />
    </div>
  );
}
