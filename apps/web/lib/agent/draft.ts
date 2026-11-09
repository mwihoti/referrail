import { serverConfig } from "@/lib/config";
import type { OfferDraft } from "@/lib/types";

/**
 * Offer-drafting agent.
 *
 * The agent never holds a wallet key and never moves funds: it turns a sentence
 * into a *draft* that the merchant reviews and publishes from their own wallet.
 *
 * Primary path: NEAR AI Cloud (OpenAI-compatible chat completions).
 * Fallback: a deterministic rule-based parser so the demo works without
 * inference credits. `source` in the response says which one ran.
 */

const SYSTEM_PROMPT = `You convert a merchant's plain-language description of an offer into strict JSON for the ReferRail NEAR contract.
Return ONLY JSON with these keys:
{
  "title": string (<=120 chars),
  "description": string (<=2000 chars),
  "price": number (in whole token units, e.g. 20 for "20 USDC"),
  "commission_bps": integer (creator share in basis points, 1500 = 15%),
  "refund_hold_hours": number (0 if the merchant did not ask for a hold),
  "payout_account": string (only if the merchant explicitly named an account; otherwise ""),
  "intents_dest": null or {"chain": string, "asset_id": string, "recipient": string},
  "rationale": string (one sentence),
  "assumptions": string[] (each assumption you had to make)
}
Never invent wallet addresses or account ids. If a value is not stated, use 0 / "" / null and list it in assumptions.
commission_bps must leave room for a 2% protocol fee: keep it under 9800.`;

export interface DraftResult {
  draft: OfferDraft;
  source: "llm" | "rules";
  note: string;
}

function clampBps(bps: number): number {
  if (!Number.isFinite(bps) || bps < 0) return 0;
  return Math.min(Math.round(bps), 9_000);
}

function cleanAccount(candidate: string | undefined): string {
  if (!candidate) return "";
  const value = candidate.trim().toLowerCase().replace(/[.,;:]+$/, "");
  return /^(([a-z\d]+[-_])*[a-z\d]+\.)+([a-z\d]+[-_])*[a-z\d]+$/.test(value) &&
    (value.endsWith(".near") || value.endsWith(".testnet"))
    ? value
    : "";
}

/** Deterministic parser: "I sell a $20 class, 15% to creators, pay me usdc.testnet". */
export function rulesDraft(prompt: string): OfferDraft {
  const text = prompt.trim();
  const lower = text.toLowerCase();
  const assumptions: string[] = [];

  const percentMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*%\s*(?:of\s+)?(?:the\s+)?(?:sale|revenue|commission)?[^.]{0,20}?creators?/) ??
    lower.match(/creators?[^.]{0,30}?(\d+(?:[.,]\d+)?)\s*%/);
  const commission = percentMatch ? Number(percentMatch[1].replace(",", ".")) : NaN;
  const commissionBps = Number.isFinite(commission) ? clampBps(commission * 100) : 1500;
  if (!percentMatch) assumptions.push("No creator commission stated — defaulted to 15%.");

  const priceMatch = lower.match(/(?:$|usd|usdc|near|\b)\s*(\d+(?:[.,]\d+)?)\s*(?:usd|usdc|dollars?|near)?/);
  let price = NaN;
  const explicitPrice = lower.match(/(?:\$|usd\s*|usdc\s*|price\s*(?:of|is)?\s*)(\d+(?:[.,]\d+)?)/) ??
    lower.match(/(\d+(?:[.,]\d+)?)\s*(?:usd|usdc|dollars?)/);
  if (explicitPrice) price = Number(explicitPrice[1].replace(",", "."));
  else if (priceMatch) price = Number(priceMatch[1].replace(",", "."));
  if (!Number.isFinite(price) || price <= 0) {
    price = 10;
    assumptions.push("No price recognised — defaulted to 10 token units.");
  }

  const hoursMatch = lower.match(/(\d+)\s*(?:hours?|hrs?|h)\b/);
  const daysMatch = lower.match(/(\d+)\s*(?:days?|d)\b/);
  let holdHours = 0;
  if (hoursMatch) holdHours = Number(hoursMatch[1]);
  else if (daysMatch) holdHours = Number(daysMatch[1]) * 24;
  else if (lower.includes("no hold") || lower.includes("immediate")) holdHours = 0;

  const accountMatch = text.match(/\b([a-z0-9][a-z0-9._-]*\.(?:near|testnet))\b/i);
  const payoutAccount = cleanAccount(accountMatch?.[1]);
  if (!payoutAccount) assumptions.push("No payout account stated — the publishing wallet is used.");

  // Title: strip the commercial clauses and keep the product phrase.
  let title = text
    .replace(/\b(i|we)\s+(sell|offer|am selling)\b/i, "")
    .replace(/\bcreators?\s+(get|receive|earn)\b[^,.;]*/i, "")
    .replace(/\bpay\s+me\b[^,.;]*/i, "")
    .replace(/[$€£]\s*\d+(?:[.,]\d+)?/g, "")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:usd|usdc|dollars?|near)\b/gi, "")
    .replace(/\b\d+(?:[.,]\d+)?\s*%/g, "")
    .split(/[,.;]/)[0]
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(a|an|the)\s+/i, "")
    .trim();
  if (!title) title = "Untitled offer";
  title = title.charAt(0).toUpperCase() + title.slice(1);
  if (title.length > 120) title = `${title.slice(0, 117)}...`;

  return {
    title,
    description: text || "No description provided.",
    price,
    commission_bps: commissionBps,
    refund_hold_hours: holdHours,
    payout_account: payoutAccount,
    intents_dest: null,
    rationale: `Drafted from your sentence with a ${(commissionBps / 100).toFixed(2).replace(/\.00$/, "")}% creator commission, a ${price} unit price and a ${holdHours}h refund hold.`,
    assumptions,
  };
}

function parseLlmJson(raw: string): Partial<OfferDraft> | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Partial<OfferDraft>;
  } catch {
    return null;
  }
}

export async function draftOffer(prompt: string): Promise<DraftResult> {
  const config = serverConfig();
  const fallback = rulesDraft(prompt);
  if (!config.agentApiKey) {
    return {
      draft: fallback,
      source: "rules",
      note: "NEAR_AI_API_KEY is not set, so the deterministic rules parser drafted this offer.",
    };
  }

  try {
    const response = await fetch(`${config.agentBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.agentApiKey}`,
      },
      body: JSON.stringify({
        model: config.agentModel,
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) throw new Error(`agent HTTP ${response.status}`);
    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    const parsed = content ? parseLlmJson(content) : null;
    if (!parsed) throw new Error("agent returned unparsable JSON");

    const draft: OfferDraft = {
      title: (parsed.title || fallback.title).toString().slice(0, 120),
      description: (parsed.description || fallback.description).toString().slice(0, 2_000),
      price: Number(parsed.price) > 0 ? Number(parsed.price) : fallback.price,
      commission_bps: clampBps(Number(parsed.commission_bps ?? fallback.commission_bps)),
      refund_hold_hours:
        Number(parsed.refund_hold_hours) >= 0 ? Number(parsed.refund_hold_hours) : fallback.refund_hold_hours,
      payout_account: cleanAccount(parsed.payout_account) || fallback.payout_account,
      intents_dest: parsed.intents_dest ?? null,
      rationale: (parsed.rationale || fallback.rationale).toString(),
      assumptions: Array.isArray(parsed.assumptions)
        ? parsed.assumptions.map((a) => String(a)).slice(0, 6)
        : fallback.assumptions,
    };
    return { draft, source: "llm", note: `Drafted by ${config.agentModel}. Review before publishing.` };
  } catch (error) {
    return {
      draft: fallback,
      source: "rules",
      note: `Agent API unavailable (${error instanceof Error ? error.message : "unknown error"}); used the deterministic parser.`,
    };
  }
}
