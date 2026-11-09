/**
 * Demonstrate the gasless creator claim from the CLI:
 * sign a NEP-366 delegate with the creator key, POST it to /api/relay, and let
 * the relayer pay the gas.
 *
 * Usage: npm run relay-client -- <offerId> <code>
 */

import { env, log, required, signedDelegate, view } from "./lib/near";

async function main(): Promise<void> {
  const offerId = Number(process.argv[2]);
  const code = process.argv[3];
  if (!Number.isInteger(offerId) || offerId < 1) throw new Error("Usage: npm run relay-client -- <offerId> <code>");
  if (!code || !/^[a-z0-9_-]{1,32}$/i.test(code)) throw new Error("code must be 1–32 alphanumeric/-/_ characters");

  const contractId = required("NEAR_CONTRACT_ID");
  const creator = {
    accountId: required("NEAR_CREATOR_ACCOUNT"),
    privateKey: required("NEAR_CREATOR_PRIVATE_KEY"),
  };
  const baseUrl = env("NEXT_PUBLIC_APP_URL", "http://localhost:3000");

  const offer = await view<{ id: number }>(contractId, "get_offer", { offer_id: offerId });
  if (!offer) throw new Error(`Offer ${offerId} not found on ${contractId}`);

  log("sign", `building a SignedDelegateAction as ${creator.accountId} (no gas, no broadcast)`);
  const payload = await signedDelegate({
    senderId: creator.accountId,
    privateKey: creator.privateKey,
    contractId,
    method: "register_creator",
    args: { offer_id: offerId, code, payout_account: creator.accountId, commission_bps_override: null },
  });

  log("relay", `POST ${baseUrl}/api/relay (${payload.length} base64 chars)`);
  const response = await fetch(`${baseUrl}/api/relay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signedDelegate: payload }),
  });
  const body = (await response.json()) as { ok?: boolean; error?: string; outcome?: { transaction?: { hash?: string } } };
  if (!response.ok || !body.ok) throw new Error(body.error ?? `Relay failed with HTTP ${response.status}`);

  log("done", `relayed by the sponsor · tx ${body.outcome?.transaction?.hash ?? "(no hash in response)"}`);
  log("check", `${baseUrl}/creator · code "${code}" is now attributed to ${creator.accountId}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
