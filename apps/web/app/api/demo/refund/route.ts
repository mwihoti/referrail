import { NextResponse } from "next/server";
import { demoDisabled, errorMessage, jsonError, readNumber, requireContract } from "@/lib/api";
import { demoAccount } from "@/lib/config";
import { getSale } from "@/lib/near/server";
import { callContract } from "@/lib/near/signer";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Demo-only: the seeded merchant refunds a pending sale. */
export async function POST(request: Request) {
  if (!rateLimit(clientKey(request, "demo-refund"), 10)) {
    return jsonError("Too many refund attempts; wait a minute.", 429);
  }
  const disabled = demoDisabled();
  if (disabled) return disabled;
  const missing = requireContract();
  if (missing) return missing;

  const merchant = demoAccount("merchant");
  if (!merchant) return jsonError("DEMO_MERCHANT_ACCOUNT / DEMO_MERCHANT_PRIVATE_KEY are not set", 503);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body");
  }
  const saleId = readNumber((body as { saleId?: unknown })?.saleId);
  if (saleId === null) return jsonError("saleId is required");

  const sale = await getSale(saleId);
  if (!sale) return jsonError(`Sale ${saleId} not found`, 404);
  if (sale.status !== "Pending") return jsonError(`Sale ${saleId} is already ${sale.status}`, 409);

  try {
    const outcome = await callContract({
      accountId: merchant.account,
      privateKey: merchant.privateKey,
      method: "refund",
      args: { sale_id: saleId },
      gasTgas: 100,
    });
    return NextResponse.json({ ok: true, mode: "demo-merchant", sale_id: saleId, outcome });
  } catch (error) {
    return jsonError(`Refund failed: ${errorMessage(error)}`, 502);
  }
}
