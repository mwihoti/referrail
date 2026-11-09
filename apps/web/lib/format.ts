/** Formatting helpers shared by server and client components. */

export function formatUnits(value: string | number | bigint, decimals: number): string {
  const raw = BigInt(typeof value === "string" ? value : Math.trunc(Number(value)).toString());
  if (decimals === 0) return raw.toString();
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const fraction = raw % divisor;
  if (fraction === 0n) return whole.toString();
  const padded = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${padded}`;
}

export function toSmallestUnits(value: number, decimals: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  const [wholePart, fractionPart = ""] = value.toString().split(".");
  const fraction = (fractionPart + "0".repeat(decimals)).slice(0, decimals);
  return `${wholePart}${fraction}`.replace(/^0+(?=\d)/, "");
}

export function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

export function shortAccount(account: string | null | undefined): string {
  if (!account) return "—";
  if (account.length <= 18) return account;
  return `${account.slice(0, 8)}…${account.slice(-6)}`;
}

export function formatDate(ns: number): string {
  if (!ns) return "—";
  return new Date(Number(ns / 1_000_000)).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export function holdLabel(ns: number): string {
  if (ns === 0) return "none (release immediately)";
  const seconds = Math.round(ns / 1_000_000_000);
  if (seconds % 86_400 === 0) return `${seconds / 86_400} day(s)`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600} hour(s)`;
  if (seconds % 60 === 0) return `${seconds / 60} minute(s)`;
  return `${seconds} second(s)`;
}

export function hoursToNs(hours: number): number {
  return Math.max(0, Math.round(hours * 3_600_000_000_000));
}
