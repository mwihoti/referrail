import { NextResponse } from "next/server";
import { demoAccount, relayerKeys, serverConfig } from "@/lib/config";
import { getConfig, getStats } from "@/lib/near/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = serverConfig();
  const [contractConfig, stats] = config.contractId
    ? await Promise.all([getConfig(), getStats()])
    : [null, null];

  return NextResponse.json({
    ok: Boolean(config.contractId),
    network: config.network,
    rpc_url: config.rpcUrl,
    contract_id: config.contractId || null,
    ft_account: config.ftAccount || null,
    contract_reachable: Boolean(contractConfig),
    paused_global: contractConfig?.paused_global ?? null,
    protocol_fee_bps: contractConfig?.protocol_fee_bps ?? null,
    stats,
    relayer_configured: Boolean(relayerKeys()),
    relayer_account: config.relayerAccount || null,
    demo_mode: config.demoMode,
    demo_accounts: {
      merchant: demoAccount("merchant")?.account ?? null,
      creator: demoAccount("creator")?.account ?? null,
      buyer: demoAccount("buyer")?.account ?? null,
    },
    agent: {
      configured: Boolean(config.agentApiKey),
      provider: config.agentApiKey ? "near-ai-cloud" : "deterministic-rules-fallback",
      model: config.agentApiKey ? config.agentModel : null,
    },
    intents: {
      api_base: config.intentsBaseUrl,
      jwt_configured: Boolean(config.intentsJwt),
      live_allowed: config.confirmLiveIntents,
      note: "NEAR Intents is mainnet-only; quotes are dry by default.",
    },
  });
}
