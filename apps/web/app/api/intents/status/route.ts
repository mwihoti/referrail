import { NextResponse } from "next/server";
import { errorMessage, jsonError } from "@/lib/api";
import { fetchStatus } from "@/lib/intents";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const depositAddress = new URL(request.url).searchParams.get("depositAddress");
  if (!depositAddress || depositAddress.length > 200) {
    return jsonError("?depositAddress=<address from a live quote> is required");
  }
  try {
    return NextResponse.json({ ok: true, status: await fetchStatus(depositAddress) });
  } catch (error) {
    return jsonError(`Status lookup failed: ${errorMessage(error)}`, 502);
  }
}
