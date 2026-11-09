/** Server-side configuration, read from environment variables at request time. */

export interface ServerConfig {
  network: "testnet" | "mainnet";
  rpcUrl: string;
  contractId: string;
  ftAccount: string;
  treasuryAccount: string;
  relayerAccount: string;
  tokenDecimals: number;
  tokenSymbol: string;
  intentsBaseUrl: string;
  intentsJwt: string;
  confirmLiveIntents: boolean;
  demoMode: boolean;
  agentBaseUrl: string;
  agentApiKey: string;
  agentModel: string;
  appUrl: string;
}

function env(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export function serverConfig(): ServerConfig {
  return {
    network: env("NEAR_NETWORK", "testnet") === "mainnet" ? "mainnet" : "testnet",
    rpcUrl: env("NEAR_RPC_URL", "https://test.rpc.fastnear.com"),
    contractId: env("NEAR_CONTRACT_ID"),
    ftAccount: env("NEAR_FT_ACCOUNT"),
    treasuryAccount: env("NEAR_TREASURY_ACCOUNT"),
    relayerAccount: env("NEAR_RELAYER_ACCOUNT"),
    tokenDecimals: Number(env("NEAR_FT_DECIMALS", "6")) || 6,
    tokenSymbol: env("NEAR_FT_SYMBOL", "tUSDC"),
    intentsBaseUrl: env("INTENTS_API_BASE", "https://1click.chaindefuser.com").replace(/\/$/, ""),
    intentsJwt: env("INTENTS_JWT"),
    confirmLiveIntents: env("CONFIRM_LIVE_INTENTS", "no") === "yes",
    demoMode: env("DEMO_MODE", "no") === "yes",
    agentBaseUrl: env("NEAR_AI_BASE_URL", "https://cloud-api.near.ai/v1").replace(/\/$/, ""),
    agentApiKey: env("NEAR_AI_API_KEY"),
    agentModel: env("NEAR_AI_MODEL", "Qwen3-235B-A22B"),
    appUrl: env("NEXT_PUBLIC_APP_URL", "http://localhost:3000"),
  };
}

export interface DemoAccount {
  account: string;
  privateKey: string;
}

/** Demo signing keys for seeded throwaway testnet personas (never mainnet). */
export function demoAccount(role: "merchant" | "creator" | "buyer"): DemoAccount | null {
  const account = env(`DEMO_${role.toUpperCase()}_ACCOUNT`);
  const privateKey = env(`DEMO_${role.toUpperCase()}_PRIVATE_KEY`);
  if (!account || !privateKey) return null;
  return { account, privateKey };
}

export function relayerKeys(): { account: string; keys: string[] } | null {
  const account = env("NEAR_RELAYER_ACCOUNT");
  const single = env("NEAR_RELAYER_PRIVATE_KEY");
  const many = env("NEAR_RELAYER_PRIVATE_KEYS");
  if (!account) return null;
  let keys: string[] = [];
  if (many) {
    try {
      const parsed = JSON.parse(many) as unknown;
      if (Array.isArray(parsed)) keys = parsed.filter((k): k is string => typeof k === "string");
    } catch {
      keys = [];
    }
  }
  if (single) keys.push(single);
  if (keys.length === 0) return null;
  return { account, keys };
}
