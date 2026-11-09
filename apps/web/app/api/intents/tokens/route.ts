import { NextResponse } from "next/server";
import { errorMessage, jsonError } from "@/lib/api";
import { serverConfig } from "@/lib/config";
import { fetchTokens } from "@/lib/intents";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").toLowerCase();
  const chain = (url.searchParams.get("chain") ?? "").toLowerCase();
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 500) || 500, 1000);

  try {
    const tokens = await fetchTokens();
    const filtered = tokens
      .filter((token) => (chain ? token.blockchain.toLowerCase() === chain : true))
      .filter((token) =>
        query
          ? token.symbol.toLowerCase().includes(query) ||
            token.assetId.toLowerCase().includes(query) ||
            token.blockchain.toLowerCase().includes(query)
          : true,
      )
      .slice(0, limit);
    return NextResponse.json({
      ok: true,
      count: tokens.length,
      chains: [...new Set(tokens.map((token) => token.blockchain))].sort(),
      tokens: filtered,
      jwt_configured: Boolean(serverConfig().intentsJwt),
      note: "Live list from 1Click (mainnet). Tokens are filtered from the response, never hard-coded.",
    });
  } catch (error) {
    return jsonError(`Could not load 1Click tokens: ${errorMessage(error)}`, 502);
  }
}
