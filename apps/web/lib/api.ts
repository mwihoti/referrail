import { NextResponse } from "next/server";
import { serverConfig } from "@/lib/config";

export function jsonError(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export function readNumber(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function readString(value: unknown, maxLength = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

export function readAmount(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{1,39}$/.test(value)) return null;
  return value;
}

/** Demo signing routes are disabled unless DEMO_MODE=yes on the server. */
export function demoDisabled(): NextResponse | null {
  if (!serverConfig().demoMode) {
    return jsonError(
      "Demo signing is off. Connect a wallet, or set DEMO_MODE=yes with seeded demo accounts.",
      503,
    );
  }
  return null;
}

export function requireContract(): NextResponse | null {
  const config = serverConfig();
  if (!config.contractId) return jsonError("NEAR_CONTRACT_ID is not configured", 503);
  if (!config.ftAccount) return jsonError("NEAR_FT_ACCOUNT is not configured", 503);
  return null;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}
