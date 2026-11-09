import { NextResponse } from "next/server";
import { errorMessage, jsonError, readAmount, readString } from "@/lib/api";
import { serverConfig } from "@/lib/config";
import { requestQuote } from "@/lib/intents";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Quotes are always dry unless the deployment sets CONFIRM_LIVE_INTENTS=yes and
 * the request carries `confirmLive: true`. There is no Intents testnet, so a
 * live quote leads to a real mainnet deposit address.
 */
export async function POST(request: Request) {
  if (!rateLimit(clientKey(request, "quote"), 30)) {
    return jsonError("Too many quote requests; wait a minute.", 429);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body");
  }
  const payload = (body ?? {}) as Record<string, unknown>;
  const originAsset = readString(payload.originAsset, 200);
  const destinationAsset = readString(payload.destinationAsset, 200);
  const amount = readAmount(payload.amount);
  const recipient = readString(payload.recipient, 200);
  if (!originAsset || !destinationAsset) {
    return jsonError("originAsset and destinationAsset are required (asset ids from /v0/tokens)");
  }
  if (!amount) return jsonError("amount must be an integer string in the origin asset's smallest units");
  if (!recipient) return jsonError("recipient is required");
  const refundTo = readString(payload.refundTo, 200);
  if (!refundTo) {
    return jsonError(
      "refundTo is required: an address on the origin chain. 1Click refuses a quote without it.",
    );
  }

  const config = serverConfig();
  const confirmLive = payload.confirmLive === true;

  try {
    const { quote, live } = await requestQuote({
      originAsset,
      destinationAsset,
      amount,
      recipient,
      recipientType: typeof payload.recipientType === "string" ? payload.recipientType : undefined,
      refundTo,
      refundType: typeof payload.refundType === "string" ? payload.refundType : undefined,
      slippageTolerance:
        typeof payload.slippageTolerance === "number" ? payload.slippageTolerance : undefined,
      dry: !confirmLive,
      confirmLive,
    });
    return NextResponse.json({
      ok: true,
      live,
      dry: !live,
      note: live
        ? "LIVE mainnet quote: sending to the returned deposit address spends real funds."
        : "Dry quote: validated and priced, no deposit address, no funds moved.",
      fee_note: config.intentsJwt
        ? "Authenticated partner traffic (JWT set)."
        : "Unauthenticated traffic: 1Click applies an extra fee (docs: +0.25%; HACKATHON.md: 0.2%).",
      quote,
    });
  } catch (error) {
    return jsonError(`Quote failed: ${errorMessage(error)}`, 502);
  }
}
