import { serverConfig } from "@/lib/config";

/**
 * NEAR Intents / 1Click client (MAINNET only — there is no Intents testnet).
 *
 * `dry: true` quotes price a route without creating a deposit address. The
 * server forces dry quotes unless CONFIRM_LIVE_INTENTS=yes *and* the caller
 * explicitly asks for a live quote.
 */

export interface IntentsToken {
  assetId: string;
  symbol: string;
  blockchain: string;
  decimals: number;
  contractAddress?: string;
  price?: number;
}

interface RawToken {
  assetId?: string;
  symbol?: string;
  blockchain?: string;
  decimals?: number;
  contractAddress?: string;
  price?: number;
}

let tokenCache: { at: number; tokens: IntentsToken[] } | null = null;
const TOKEN_TTL_MS = 10 * 60 * 1000;

function headers(): Record<string, string> {
  const { intentsJwt } = serverConfig();
  const base: Record<string, string> = { Accept: "application/json" };
  if (intentsJwt) {
    base["X-API-Key"] = intentsJwt;
    base.Authorization = `Bearer ${intentsJwt}`;
  }
  return base;
}

export async function fetchTokens(): Promise<IntentsToken[]> {
  if (tokenCache && Date.now() - tokenCache.at < TOKEN_TTL_MS) return tokenCache.tokens;
  const { intentsBaseUrl } = serverConfig();
  const response = await fetch(`${intentsBaseUrl}/v0/tokens`, {
    headers: headers(),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`1Click tokens HTTP ${response.status}`);
  const raw = (await response.json()) as RawToken[];
  const tokens = raw
    .filter((token): token is RawToken & { assetId: string; symbol: string; blockchain: string } =>
      Boolean(token.assetId && token.symbol && token.blockchain),
    )
    .map((token) => ({
      assetId: token.assetId,
      symbol: token.symbol,
      blockchain: token.blockchain,
      decimals: typeof token.decimals === "number" ? token.decimals : 18,
      contractAddress: token.contractAddress,
      price: token.price,
    }))
    .sort((a, b) => a.blockchain.localeCompare(b.blockchain) || a.symbol.localeCompare(b.symbol));
  tokenCache = { at: Date.now(), tokens };
  return tokens;
}

export interface QuoteRequest {
  originAsset: string;
  destinationAsset: string;
  amount: string;
  recipient: string;
  recipientType?: string;
  refundTo?: string;
  refundType?: string;
  depositType?: string;
  slippageTolerance?: number;
  dry?: boolean;
  confirmLive?: boolean;
}

export async function requestQuote(input: QuoteRequest): Promise<{ quote: unknown; live: boolean }> {
  const { intentsBaseUrl, confirmLiveIntents } = serverConfig();
  const wantsLive = input.confirmLive === true && confirmLiveIntents;
  const deadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const body = {
    dry: !wantsLive,
    swapType: "EXACT_INPUT",
    slippageTolerance: input.slippageTolerance ?? 100,
    originAsset: input.originAsset,
    destinationAsset: input.destinationAsset,
    amount: input.amount,
    recipient: input.recipient,
    recipientType: input.recipientType ?? "DESTINATION_CHAIN",
    // 1Click rejects a quote without an explicit deposit type.
    depositType: input.depositType ?? "ORIGIN_CHAIN",
    // 1Click rejects quotes without a refund address that is valid on the
    // origin chain, so callers must supply one rather than reusing `recipient`.
    refundTo: input.refundTo,
    refundType: input.refundType ?? "ORIGIN_CHAIN",
    deadline,
  };
  const response = await fetch(`${intentsBaseUrl}/v0/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`1Click quote HTTP ${response.status}: ${text.slice(0, 300)}`);
  return { quote: JSON.parse(text) as unknown, live: wantsLive };
}

export async function fetchStatus(depositAddress: string): Promise<unknown> {
  const { intentsBaseUrl } = serverConfig();
  const response = await fetch(
    `${intentsBaseUrl}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`,
    { headers: headers(), signal: AbortSignal.timeout(20_000), cache: "no-store" },
  );
  const text = await response.text();
  if (!response.ok) throw new Error(`1Click status HTTP ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as unknown;
}
