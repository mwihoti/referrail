import { NextResponse } from "next/server";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { importShopify } from "@/lib/shopify-import";

export const dynamic = "force-dynamic";

/** GET /api/import/shopify?url=<store or product URL> */
export async function GET(request: Request) {
  if (!rateLimit(clientKey(request, "import-shopify"), 10)) {
    return NextResponse.json(
      { ok: false, error: "Too many imports. Try again in a minute." },
      { status: 429 },
    );
  }
  const url = new URL(request.url).searchParams.get("url");
  const result = await importShopify(url);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, store: result.store, products: result.products });
}
