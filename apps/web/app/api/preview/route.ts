import { NextResponse } from "next/server";
import { jsonError, readAmount, readNumber } from "@/lib/api";
import { getOffer, previewSplit } from "@/lib/near/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const offerId = readNumber(url.searchParams.get("offer"));
  if (offerId === null) return jsonError("?offer=<id> is required");
  const ref = url.searchParams.get("ref");
  const offer = await getOffer(offerId);
  if (!offer) return jsonError(`Offer ${offerId} not found`, 404);

  const amount = readAmount(url.searchParams.get("amount")) ?? offer.price;
  const preview = await previewSplit(offerId, amount, ref || null);
  if (!preview) return jsonError("Could not read preview_split (contract unreachable?)", 502);
  return NextResponse.json({ ok: true, offer, preview });
}
