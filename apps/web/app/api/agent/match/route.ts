import { NextResponse } from "next/server";
import { matchCreators } from "@/lib/agent/match";
import { jsonError, readNumber } from "@/lib/api";
import { getOffer } from "@/lib/near/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body");
  }
  const offerId = readNumber((body as { offerId?: unknown })?.offerId);
  if (offerId === null) return jsonError("Send { offerId: number }");

  const offer = await getOffer(offerId);
  if (!offer) return jsonError(`Offer ${offerId} not found`, 404);

  return NextResponse.json({
    ok: true,
    offer_id: offer.id,
    matches: matchCreators(offer),
    note: "Deterministic keyword matching over data/creators.json; reasons are shown, not hidden.",
  });
}
