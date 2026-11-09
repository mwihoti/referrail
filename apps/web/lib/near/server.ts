import { JsonRpcProvider } from "near-api-js";
import { serverConfig } from "@/lib/config";
import type {
  CreatorLink,
  Offer,
  ProtocolConfig,
  Sale,
  SplitPreview,
  Stats,
  TokenMeta,
} from "@/lib/types";

let cachedProvider: { url: string; provider: JsonRpcProvider } | null = null;

export function provider(): JsonRpcProvider {
  const { rpcUrl } = serverConfig();
  if (!cachedProvider || cachedProvider.url !== rpcUrl) {
    cachedProvider = { url: rpcUrl, provider: new JsonRpcProvider({ url: rpcUrl }) };
  }
  return cachedProvider.provider;
}

/** Call a read-only contract method. Returns null when the app is not configured. */
export async function view<T>(method: string, args: Record<string, unknown> = {}): Promise<T | null> {
  const { contractId } = serverConfig();
  if (!contractId) return null;
  try {
    const result = await provider().callFunction({ contractId, method, args });
    return (result ?? null) as T | null;
  } catch (error) {
    console.error(`[near] view ${method} failed:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/** View a NEP-141 token directly (used for balances in the demo screens). */
export async function tokenView<T>(
  token: string,
  method: string,
  args: Record<string, unknown> = {},
): Promise<T | null> {
  if (!token) return null;
  try {
    const result = await provider().callFunction({ contractId: token, method, args });
    return (result ?? null) as T | null;
  } catch (error) {
    console.error(`[near] token view ${method} failed:`, error instanceof Error ? error.message : error);
    return null;
  }
}

export async function getConfig(): Promise<ProtocolConfig | null> {
  return view<ProtocolConfig>("get_config");
}

export async function getOffer(offerId: number): Promise<Offer | null> {
  return view<Offer>("get_offer", { offer_id: offerId });
}

export async function listOffers(from = 0, limit = 50): Promise<Offer[]> {
  return (await view<Offer[]>("list_offers", { from, limit })) ?? [];
}

export async function getSale(saleId: number): Promise<Sale | null> {
  return view<Sale>("get_sale", { sale_id: saleId });
}

export async function listSales(from = 0, limit = 100): Promise<Sale[]> {
  return (await view<Sale[]>("list_sales", { from, limit })) ?? [];
}

export async function listSalesByOffer(offerId: number, from = 0, limit = 50): Promise<Sale[]> {
  return (await view<Sale[]>("list_sales_by_offer", { offer_id: offerId, from, limit })) ?? [];
}

export async function listSalesByCreator(account: string, from = 0, limit = 50): Promise<Sale[]> {
  return (await view<Sale[]>("list_sales_by_creator", { account, from, limit })) ?? [];
}

export async function getCreator(offerId: number, code: string): Promise<CreatorLink | null> {
  return view<CreatorLink>("get_creator", { offer_id: offerId, code });
}

export async function getCreatorByAccount(offerId: number, account: string): Promise<CreatorLink | null> {
  return view<CreatorLink>("get_creator_by_account", { offer_id: offerId, account });
}

export async function previewSplit(
  offerId: number,
  amount: string,
  refCode: string | null,
): Promise<SplitPreview | null> {
  return view<SplitPreview>("preview_split", {
    offer_id: offerId,
    amount,
    ref_code: refCode,
  });
}

export async function getStats(): Promise<Stats | null> {
  return view<Stats>("stats");
}

export async function getTokenMeta(): Promise<TokenMeta | null> {
  const { ftAccount } = serverConfig();
  return tokenView<TokenMeta>(ftAccount, "ft_metadata");
}

export async function getTokenBalance(account: string): Promise<string | null> {
  const { ftAccount } = serverConfig();
  const result = await tokenView<{ "0"?: string } | string>(ftAccount, "ft_balance_of", {
    account_id: account,
  });
  if (result === null) return null;
  if (typeof result === "string") return result;
  return result?.toString() ?? null;
}
