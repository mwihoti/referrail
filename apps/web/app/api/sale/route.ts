import { NextResponse } from "next/server";
import { jsonError, readNumber } from "@/lib/api";
import { getOffer, getSale } from "@/lib/near/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const saleId = readNumber(url.searchParams.get("id"));
  if (saleId === null) return jsonError("?id=<sale id> is required");
  const sale = await getSale(saleId);
  if (!sale) return jsonError(`Sale ${saleId} not found`, 404);
  const offer = await getOffer(sale.offer_id);
  return NextResponse.json({
    ok: true,
    sale,
    offer: offer ? { id: offer.id, title: offer.title, token: offer.token } : null,
    releasable: sale.status === "Pending" && Date.now() * 1_000_000 >= Number(sale.release_at_ns),
  });
}
