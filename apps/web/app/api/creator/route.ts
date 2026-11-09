import { NextResponse } from "next/server";
import { jsonError, readNumber } from "@/lib/api";
import { getCreatorByAccount, getOffer, listSalesByCreator } from "@/lib/near/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const account = url.searchParams.get("account");
  if (!account || !/^[a-z0-9._-]{2,64}$/.test(account)) {
    return jsonError("?account=<near account> is required");
  }
  const offerId = readNumber(url.searchParams.get("offer"));
  const link = offerId === null ? null : await getCreatorByAccount(offerId, account);
  const offer = offerId === null ? null : await getOffer(offerId);
  const sales = await listSalesByCreator(account, 0, 100);

  return NextResponse.json({
    ok: true,
    account,
    link,
    offer: offer ? { id: offer.id, title: offer.title, commission_bps: offer.commission_bps } : null,
    sales,
    earnings: sales
      .filter((sale) => sale.status !== "Refunded")
      .reduce((total, sale) => total + BigInt(sale.creator_amount), 0n)
      .toString(),
  });
}
