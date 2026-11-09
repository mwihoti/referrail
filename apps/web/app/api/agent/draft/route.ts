import { NextResponse } from "next/server";
import { draftOffer } from "@/lib/agent/draft";
import { errorMessage, jsonError, readString } from "@/lib/api";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!rateLimit(clientKey(request, "draft"), 20)) {
    return jsonError("Too many drafts in a minute; wait a moment.", 429);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body");
  }
  const prompt = readString((body as { prompt?: unknown })?.prompt, 1_000);
  if (!prompt) return jsonError("Send { prompt: string } (1–1000 characters)");

  try {
    const result = await draftOffer(prompt);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return jsonError(`Draft failed: ${errorMessage(error)}`, 500);
  }
}
