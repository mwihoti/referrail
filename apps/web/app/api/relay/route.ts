import { NextResponse } from "next/server";
import { errorMessage, jsonError } from "@/lib/api";
import { relayerKeys } from "@/lib/config";
import {
  decodeSignedDelegate,
  relaySignedDelegate,
  validateSponsorableDelegate,
} from "@/lib/near/signer";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * NEP-366 relayer. Accepts `{ signedDelegate: base64(borsh SignedDelegateAction) }`
 * and only sponsors `register_creator` on this app's own contract.
 */
export async function POST(request: Request) {
  if (!rateLimit(clientKey(request, "relay"), 30)) {
    return jsonError("Too many relay requests; wait a minute.", 429);
  }
  const relayer = relayerKeys();
  if (!relayer) return jsonError("Relayer is not configured on this deployment", 503);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body");
  }
  const encoded = (body as { signedDelegate?: unknown })?.signedDelegate;
  if (typeof encoded !== "string" || encoded.length < 32 || encoded.length > 40_000) {
    return jsonError("Send { signedDelegate: base64 string }");
  }

  let senderId: string | undefined;
  try {
    const signedDelegate = decodeSignedDelegate(encoded);
    const verdict = validateSponsorableDelegate(signedDelegate);
    if (!verdict.ok) return jsonError(`Not sponsored: ${verdict.reason}`, 403);
    senderId = verdict.senderId;
  } catch (error) {
    return jsonError(`Could not decode signed delegate: ${errorMessage(error)}`);
  }

  try {
    const outcome = await relaySignedDelegate(encoded);
    return NextResponse.json({ ok: true, sponsored_sender: senderId, outcome });
  } catch (error) {
    return jsonError(`Relay failed: ${errorMessage(error)}`, 502);
  }
}
