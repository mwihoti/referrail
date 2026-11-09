import { NextResponse } from "next/server";
import { demoDisabled, errorMessage, jsonError, readString } from "@/lib/api";
import { serverConfig } from "@/lib/config";
import { callToken } from "@/lib/near/signer";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Demo-only faucet: the test FT's owner mints demo tokens to a testnet account
 * so a judge can pay with a real wallet. Testnet only — never configure the FT
 * owner key on a mainnet deployment.
 */
export async function POST(request: Request) {
  if (!rateLimit(clientKey(request, "faucet"), 10)) {
    return jsonError("Too many faucet requests; wait a minute.", 429);
  }
  const disabled = demoDisabled();
  if (disabled) return disabled;
  const config = serverConfig();
  if (config.network !== "testnet") return jsonError("The demo faucet only runs on testnet", 403);
  if (!config.ftAccount) return jsonError("NEAR_FT_ACCOUNT is not configured", 503);

  const ownerAccount = process.env.FT_OWNER_ACCOUNT?.trim();
  const ownerKey = process.env.FT_OWNER_PRIVATE_KEY?.trim();
  if (!ownerAccount || !ownerKey) {
    return jsonError("FT_OWNER_ACCOUNT / FT_OWNER_PRIVATE_KEY are not set", 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body");
  }
  const account = readString((body as { account?: unknown })?.account, 64);
  if (!account || !/^[a-z0-9._-]+\.testnet$/.test(account)) {
    return jsonError("account must be an existing *.testnet account");
  }

  const amount = (100n * 10n ** BigInt(config.tokenDecimals)).toString();
  try {
    const outcome = await callToken({
      accountId: ownerAccount,
      privateKey: ownerKey,
      method: "mint",
      args: { account_id: account, amount },
      gasTgas: 30,
    });
    return NextResponse.json({ ok: true, account, amount, outcome });
  } catch (error) {
    return jsonError(`Faucet failed: ${errorMessage(error)}`, 502);
  }
}
