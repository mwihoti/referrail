/** Presentation helpers for the checkout page. Safe to import from server and client components. */

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** Human-readable refund window, e.g. "3 days" or "12 hours". Returns null when there is no window. */
export function refundWindowLabel(ns: number): string | null {
  if (!ns) return null;
  const seconds = Math.round(ns / 1_000_000_000);
  if (seconds % 86_400 === 0) return plural(seconds / 86_400, "day");
  if (seconds % 3_600 === 0) return plural(seconds / 3_600, "hour");
  if (seconds % 60 === 0) return plural(seconds / 60, "minute");
  return plural(seconds, "second");
}
