import { NextResponse } from "next/server";
import { errorMessage, jsonError, readNumber } from "@/lib/api";
import { relayerKeys, serverConfig } from "@/lib/config";
import { getSale } from "@/lib/near/server";
import { callContract } from "@/lib/near/signer";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Release is permissionless after the refund hold. The app's relayer sends it so
 * a buyer never needs to hold NEAR for gas, and because `ft_transfer` requires
 * 1 yoctoNEAR the caller must be able to attach it (a funded account, not a
 * function-call key).
 */
export async function POST(request: Request) {
  if (!rateLimit(clientKey(request, "release"), 20)) {
    return jsonError("Too many release attempts; wait a minute.", 429);
  }
  const config = serverConfig();
  if (!config.contractId) return jsonError("NEAR_CONTRACT_ID is not configured", 503);
  const relayer = relayerKeys();
  if (!relayer) return jsonError("Relayer is not configured, so nobody can pay release gas", 503);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body");
  }
  const saleId = readNumber((body as { saleId?: unknown })?.saleId);
  if (saleId === null) return jsonError("Send { saleId: number }");

  const sale = await getSale(saleId);
  if (!sale) return jsonError(`Sale ${saleId} not found`, 404);
  if (sale.status !== "Pending") return jsonError(`Sale ${saleId} is already ${sale.status}`, 409);
  if (Date.now() * 1_000_000 < Number(sale.release_at_ns)) {
    return jsonError("Refund hold has not elapsed yet", 409);
  }

  try {
    const outcome = await callContract({
      accountId: relayer.account,
      privateKey: relayer.keys[0],
      method: "release",
      args: { sale_id: saleId },
      gasTgas: 200,
    });
    return NextResponse.json({ ok: true, outcome });
  } catch (error) {
    return jsonError(`Release failed: ${errorMessage(error)}`, 502);
  }
}
