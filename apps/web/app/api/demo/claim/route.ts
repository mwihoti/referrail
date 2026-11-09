import { NextResponse } from "next/server";
import { demoDisabled, errorMessage, jsonError, readNumber, readString, requireContract } from "@/lib/api";
import { demoAccount, relayerKeys } from "@/lib/config";
import { callContract, createSignedDelegate, relaySignedDelegate, validateSponsorableDelegate, decodeSignedDelegate } from "@/lib/near/signer";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Demo-only: claim a creator link as the seeded demo creator.
 *
 * When the relayer is configured this builds a real NEP-366 SignedDelegateAction
 * with the creator's key, validates it exactly like `/api/relay` does, and has
 * the relayer submit it — the creator spends no NEAR. Without a relayer it falls
 * back to a direct signed call (documented in the response as `mode`).
 */
export async function POST(request: Request) {
  if (!rateLimit(clientKey(request, "demo-claim"), 20)) {
    return jsonError("Too many demo claims; wait a minute.", 429);
  }
  const disabled = demoDisabled();
  if (disabled) return disabled;
  const missing = requireContract();
  if (missing) return missing;

  const creator = demoAccount("creator");
  if (!creator) return jsonError("DEMO_CREATOR_ACCOUNT / DEMO_CREATOR_PRIVATE_KEY are not set", 503);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body");
  }
  const payload = (body ?? {}) as Record<string, unknown>;
  const offerId = readNumber(payload.offerId);
  const code = readString(payload.code, 32);
  if (offerId === null) return jsonError("offerId is required");
  if (!code || !/^[a-z0-9_-]+$/i.test(code)) return jsonError("code must be alphanumeric (dash/underscore allowed)");

  const args = {
    offer_id: offerId,
    code,
    payout_account: null,
    commission_bps_override: null,
  };

  try {
    if (relayerKeys()) {
      const encoded = await createSignedDelegate({
        senderId: creator.account,
        privateKey: creator.privateKey,
        method: "register_creator",
        args,
        gasTgas: 25,
      });
      const verdict = validateSponsorableDelegate(decodeSignedDelegate(encoded));
      if (!verdict.ok) return jsonError(`Delegate rejected: ${verdict.reason}`, 403);
      const outcome = await relaySignedDelegate(encoded);
      return NextResponse.json({
        ok: true,
        mode: "meta-tx",
        account: creator.account,
        code,
        gas_paid_by: "relayer",
        outcome,
      });
    }

    const outcome = await callContract({
      accountId: creator.account,
      privateKey: creator.privateKey,
      method: "register_creator",
      args,
      gasTgas: 30,
    });
    return NextResponse.json({
      ok: true,
      mode: "direct",
      account: creator.account,
      code,
      gas_paid_by: "demo-creator",
      note: "No relayer configured, so this claim paid its own gas.",
      outcome,
    });
  } catch (error) {
    return jsonError(`Claim failed: ${errorMessage(error)}`, 502);
  }
}
