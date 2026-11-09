import { NextResponse } from "next/server";
import { demoDisabled, errorMessage, jsonError, readNumber, readString, requireContract } from "@/lib/api";
import { demoAccount, serverConfig } from "@/lib/config";
import { toSmallestUnits, hoursToNs } from "@/lib/format";
import { callContract } from "@/lib/near/signer";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Demo-only: publish an offer signed by the seeded demo merchant persona. */
export async function POST(request: Request) {
  if (!rateLimit(clientKey(request, "demo-offer"), 10)) {
    return jsonError("Too many demo offers; wait a minute.", 429);
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
  const payload = (body ?? {}) as Record<string, unknown>;
  const title = readString(payload.title, 120);
  const description = typeof payload.description === "string" ? payload.description.slice(0, 2_000) : "";
  const price = typeof payload.price === "number" ? payload.price : Number(payload.price);
  const commissionBps = readNumber(payload.commission_bps);
  const holdHours = typeof payload.refund_hold_hours === "number" ? payload.refund_hold_hours : 0;
  const payout = readString(payload.payout_account, 64);

  if (!title) return jsonError("title is required (max 120 characters)");
  if (!Number.isFinite(price) || price <= 0) return jsonError("price must be a positive number");
  if (commissionBps === null) return jsonError("commission_bps is required");

  const config = serverConfig();
  try {
    const outcome = await callContract({
      accountId: merchant.account,
      privateKey: merchant.privateKey,
      method: "create_offer",
      args: {
        title,
        description,
        token: config.ftAccount,
        price: toSmallestUnits(price, config.tokenDecimals),
        commission_bps: commissionBps,
        refund_hold_ns: hoursToNs(holdHours),
        allowed_creators: null,
        payout_account: payout || null,
        intents_dest: null,
      },
      gasTgas: 60,
    });
    return NextResponse.json({ ok: true, mode: "demo-merchant", outcome });
  } catch (error) {
    return jsonError(`create_offer failed: ${errorMessage(error)}`, 502);
  }
}
