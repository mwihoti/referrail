import { NextResponse } from "next/server";
import { demoDisabled, errorMessage, jsonError, readNumber, readString, requireContract } from "@/lib/api";
import { demoAccount } from "@/lib/config";
import { getOffer, getStats } from "@/lib/near/server";
import { payOffer } from "@/lib/near/signer";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Demo-only: the seeded buyer pays an offer through `ft_transfer_call`. */
export async function POST(request: Request) {
  if (!rateLimit(clientKey(request, "demo-buy"), 20)) {
    return jsonError("Too many demo purchases; wait a minute.", 429);
  }
  const disabled = demoDisabled();
  if (disabled) return disabled;
  const missing = requireContract();
  if (missing) return missing;

  const buyer = demoAccount("buyer");
  if (!buyer) return jsonError("DEMO_BUYER_ACCOUNT / DEMO_BUYER_PRIVATE_KEY are not set", 503);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body");
  }
  const payload = (body ?? {}) as Record<string, unknown>;
  const offerId = readNumber(payload.offerId);
  const ref = readString(payload.ref, 32);
  if (offerId === null) return jsonError("offerId is required");

  const offer = await getOffer(offerId);
  if (!offer) return jsonError(`Offer ${offerId} not found`, 404);
  if (offer.paused) return jsonError("This offer is paused", 409);

  const before = await getStats();
  try {
    const outcome = await payOffer({
      buyerAccount: buyer.account,
      buyerPrivateKey: buyer.privateKey,
      offerId,
      refCode: ref ?? null,
      price: offer.price,
    });
    let saleId: number | null = null;
    for (let attempt = 0; attempt < 5 && saleId === null; attempt += 1) {
      const after = await getStats();
      if (after && before && after.sale_count > before.sale_count) {
        saleId = after.sale_count;
      } else {
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    }
    return NextResponse.json({
      ok: true,
      mode: "demo-buyer",
      buyer: buyer.account,
      sale_id: saleId,
      outcome,
    });
  } catch (error) {
    return jsonError(`Payment failed: ${errorMessage(error)}`, 502);
  }
}
