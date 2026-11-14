/**
 * Store metadata for offers.
 *
 * The escrow contract only stores a title and a free-text description, so the
 * product page URL and image URL are kept as trailing lines of the description:
 *
 *   <body>
 *
 *   Store: https://shop.example.com/products/thing
 *   Image: https://cdn.example.com/thing.jpg
 *
 * Both helpers are pure and safe to use on the server and in the browser.
 */

export interface OfferMeta {
  body: string;
  storeUrl: string | null;
  imageUrl: string | null;
  storeHost: string | null;
}

/** Contract limit for offer descriptions, in UTF-8 bytes. */
export const MAX_DESCRIPTION_BYTES = 2_000;
/** Longest store or image URL we will embed. */
export const MAX_META_URL_LENGTH = 400;

const META_LINE = /^(Store|Image): (https:\/\/\S+)$/;
const encoder = new TextEncoder();

function byteLength(value: string): number {
  return encoder.encode(value).length;
}

const INTERNAL_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa"];

/**
 * True for a public-looking hostname: not an IP literal, not single-label, not
 * localhost or a reserved internal suffix. Offer URLs are loaded by every
 * buyer's browser, so they must not point into the buyer's own network.
 */
function isPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host.startsWith("[") || host.includes(":")) return false; // IPv6 literal
  if (/^[0-9.]+$/.test(host)) return false; // IPv4 literal (WHATWG URL normalises hex/octal forms)
  if (!host.includes(".")) return false; // single label, e.g. "router"
  if (host === "localhost") return false;
  return !INTERNAL_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/** True for an absolute, parseable https URL on a public hostname with no whitespace or credentials. */
export function isSafeHttpsUrl(value: string): boolean {
  if (typeof value !== "string") return false;
  if (!value || value.length > MAX_META_URL_LENGTH || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !!url.hostname &&
      !url.username &&
      !url.password &&
      isPublicHostname(url.hostname)
    );
  } catch {
    return false;
  }
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./i, "") || null;
  } catch {
    return null;
  }
}

export function parseOfferDescription(description: string): OfferMeta {
  const text = typeof description === "string" ? description.replace(/\r\n?/g, "\n") : "";
  const lines = text.split("\n");

  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === "") end -= 1;

  let storeUrl: string | null = null;
  let imageUrl: string | null = null;
  let start = end;
  while (start > 0) {
    const match = META_LINE.exec(lines[start - 1].trimEnd());
    if (!match || !isSafeHttpsUrl(match[2])) break;
    if (match[1] === "Store") {
      if (storeUrl !== null) break;
      storeUrl = match[2];
    } else {
      if (imageUrl !== null) break;
      imageUrl = match[2];
    }
    start -= 1;
  }

  // The meta block must be the whole description or follow a blank line.
  const hasMeta = start < end && (start === 0 || lines[start - 1].trim() === "");
  if (!hasMeta) {
    return { body: text.trimEnd(), storeUrl: null, imageUrl: null, storeHost: null };
  }
  return {
    body: lines.slice(0, start).join("\n").trimEnd(),
    storeUrl,
    imageUrl,
    storeHost: hostOf(storeUrl),
  };
}

/** Cut a string to at most maxBytes UTF-8 bytes without splitting a character. */
function truncateToBytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (byteLength(value) <= maxBytes) return value;
  const ellipsis = "…";
  const budget = maxBytes - byteLength(ellipsis);
  if (budget <= 0) return "";
  let used = 0;
  let out = "";
  for (const char of value) {
    const size = byteLength(char);
    if (used + size > budget) break;
    out += char;
    used += size;
  }
  return `${out.trimEnd()}${ellipsis}`;
}

/** Remove any trailing Store/Image block (repeatedly) so only the body text remains. */
function stripTrailingMeta(value: string): string {
  let current = value.trimEnd();
  for (;;) {
    const parsed = parseOfferDescription(current);
    if (parsed.storeUrl === null && parsed.imageUrl === null) return current;
    current = parsed.body;
  }
}

export function buildOfferDescription(
  body: string,
  meta: { storeUrl?: string | null; imageUrl?: string | null },
): string {
  const storeUrl = meta.storeUrl && isSafeHttpsUrl(meta.storeUrl) ? meta.storeUrl : null;
  const imageUrl = meta.imageUrl && isSafeHttpsUrl(meta.imageUrl) ? meta.imageUrl : null;

  const metaLines: string[] = [];
  if (storeUrl) metaLines.push(`Store: ${storeUrl}`);
  if (imageUrl) metaLines.push(`Image: ${imageUrl}`);

  // The body must never carry its own trailing Store/Image block, otherwise it
  // would be read back as metadata the merchant did not pass in.
  const cleanBody = stripTrailingMeta((typeof body === "string" ? body : "").replace(/\r\n?/g, "\n"));
  if (!metaLines.length) return stripTrailingMeta(truncateToBytes(cleanBody, MAX_DESCRIPTION_BYTES));

  const block = metaLines.join("\n");
  const separator = "\n\n";
  const budget = MAX_DESCRIPTION_BYTES - byteLength(block) - byteLength(separator);
  const fitted = stripTrailingMeta(truncateToBytes(cleanBody, budget));
  return fitted ? `${fitted}${separator}${block}` : block;
}
