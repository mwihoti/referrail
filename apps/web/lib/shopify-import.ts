/**
 * Server-only Shopify product import.
 *
 * Fetches public product data from a Shopify storefront (/products.json or
 * /products/<handle>.json). The host comes from user input, so this is an
 * outbound-request surface: we only ever call https on the default port, on a
 * public hostname, with a fixed path we build ourselves, no redirects, a short
 * timeout and a capped body.
 *
 * Known gap: the private-address DNS check and fetch() resolve the hostname
 * separately, so a DNS-rebinding host with a zero TTL could pass the check and
 * then connect elsewhere. We accept that for now: the request is always a GET
 * over https on port 443 to a fixed path with no credentials, redirects are not
 * followed blindly, and the serverless runtime has no metadata service or
 * internal TLS endpoints. Pinning the checked address would need an undici
 * Agent with a validating connect.lookup.
 */
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { isSafeHttpsUrl } from "@/lib/offer-meta";

export interface ImportedProduct {
  title: string;
  description: string;
  price: string;
  imageUrl: string | null;
  productUrl: string;
  handle: string;
}

export type ShopifyImportResult =
  | { ok: true; store: string; products: ImportedProduct[] }
  | { ok: false; status: number; error: string };

export const MAX_IMPORT_PRODUCTS = 50;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_DESCRIPTION_CHARS = 1_500;
const MAX_TITLE_BYTES = 120;
const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{0,254}$/i;
const BLOCKED_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home.arpa"];

const MESSAGES = {
  badUrl: "Enter a valid https link to a Shopify store or product.",
  blockedHost: "That address can't be imported. Use the store's public web address.",
  badHandle: "That product link isn't supported. Paste the store address instead.",
  locked:
    "This store is password-protected or unavailable. Turn off the storefront password, or enter the product details by hand.",
  notShopify: "That doesn't look like a Shopify store.",
  noProducts: "We couldn't find any products to import from that store.",
  notFound: "Product not found.",
  rateLimited: "The store is rate-limiting requests. Try again in a minute.",
  unreachable: "We couldn't reach that store. Check the link and try again.",
  tooLarge: "That store returned more data than we can import.",
} as const;

function fail(status: number, error: string): Extract<ShopifyImportResult, { ok: false }> {
  return { ok: false, status, error };
}

// ---------------------------------------------------------------------------
// Input validation

type ImportTarget =
  | { kind: "store"; host: string }
  | { kind: "product"; host: string; handle: string };

function isBlockedHostname(hostname: string): boolean {
  if (!hostname || hostname.length > 253) return true;
  if (hostname.includes(":") || hostname.startsWith("[")) return true; // IPv6 literal
  if (hostname.endsWith(".")) return true;
  if (!/^[a-z0-9.-]+$/.test(hostname)) return true;
  if (!hostname.includes(".")) return true;
  if (isIP(hostname)) return true;
  if (/^[0-9.]+$/.test(hostname)) return true;
  if (hostname.split(".").some((label) => !label || label.length > 63)) return true;
  const lastLabel = hostname.slice(hostname.lastIndexOf(".") + 1);
  if (!/[a-z]/.test(lastLabel)) return true; // numeric TLD → IP-ish
  if (/^0x[0-9a-f]+$/.test(lastLabel)) return true; // hex IPv4 component
  if (hostname === "localhost") return true;
  return BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

/** Accept bare domains ("shop.myshopify.com") and upgrade http:// links to https://. */
export function normaliseImportUrl(raw: string): string {
  const input = raw.trim();
  if (!input) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) return input.replace(/^http:\/\//i, "https://");
  return `https://${input.replace(/^\/\//, "")}`;
}

export function parseImportTarget(raw: string | null): ImportTarget | { error: string } {
  const input = normaliseImportUrl(raw ?? "");
  if (!input || input.length > 2_000) return { error: MESSAGES.badUrl };
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { error: MESSAGES.badUrl };
  }
  if (url.protocol !== "https:") return { error: MESSAGES.badUrl };
  if (url.username || url.password) return { error: MESSAGES.badUrl };
  if (url.port && url.port !== "443") return { error: MESSAGES.badUrl };

  const host = url.hostname.toLowerCase();
  if (isBlockedHostname(host)) return { error: MESSAGES.blockedHost };

  const segments = url.pathname.split("/").filter(Boolean);
  const index = segments.lastIndexOf("products");
  if (index >= 0 && segments[index + 1]) {
    const handle = segments[index + 1].replace(/\.(json|js|xml|oembed)$/i, "");
    if (!HANDLE_PATTERN.test(handle)) return { error: MESSAGES.badHandle };
    return { kind: "product", host, handle };
  }
  return { kind: "store", host };
}

// ---------------------------------------------------------------------------
// DNS check: refuse hosts that resolve to private or reserved addresses.

function ipv4ToNumber(ip: string): number {
  return ip.split(".").reduce((acc, part) => acc * 256 + Number(part), 0);
}

function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToNumber(ip);
  const inRange = (base: string, bits: number) => {
    const size = 2 ** (32 - bits);
    const start = ipv4ToNumber(base);
    return n >= start && n < start + size;
  };
  return (
    inRange("0.0.0.0", 8) ||
    inRange("10.0.0.0", 8) ||
    inRange("100.64.0.0", 10) ||
    inRange("127.0.0.0", 8) ||
    inRange("169.254.0.0", 16) ||
    inRange("172.16.0.0", 12) ||
    inRange("192.0.0.0", 24) ||
    inRange("192.0.2.0", 24) ||
    inRange("192.168.0.0", 16) ||
    inRange("198.18.0.0", 15) ||
    inRange("198.51.100.0", 24) ||
    inRange("203.0.113.0", 24) ||
    n >= ipv4ToNumber("224.0.0.0")
  );
}

/** Global unicast space. Everything outside it (loopback, ::/96, ::ffff:0:0/96, NAT64, ULA, link and site local, multicast) is refused. */
const IPV6_GLOBAL_UNICAST = new BlockList();
IPV6_GLOBAL_UNICAST.addSubnet("2000::", 3, "ipv6");

/** Reserved or IPv4-wrapping ranges inside 2000::/3. */
const IPV6_RESERVED = new BlockList();
IPV6_RESERVED.addSubnet("2001::", 23, "ipv6"); // IETF protocol assignments, incl. Teredo 2001::/32
IPV6_RESERVED.addSubnet("2001:db8::", 32, "ipv6"); // documentation
IPV6_RESERVED.addSubnet("2002::", 16, "ipv6"); // 6to4, wraps arbitrary IPv4
IPV6_RESERVED.addSubnet("3fff::", 20, "ipv6"); // documentation

function isPrivateIPv6(ip: string): boolean {
  try {
    return !IPV6_GLOBAL_UNICAST.check(ip, "ipv6") || IPV6_RESERVED.check(ip, "ipv6");
  } catch {
    return true;
  }
}

async function resolvesToPublicAddress(host: string): Promise<boolean | null> {
  try {
    const addresses = await lookup(host, { all: true, verbatim: true });
    if (!addresses.length) return null;
    return addresses.every(({ address, family }) =>
      family === 6 ? !isPrivateIPv6(address) : !isPrivateIPv4(address),
    );
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Upstream fetch

type FetchOutcome =
  | { ok: true; json: unknown }
  | { ok: false; redirectHost: string }
  | Extract<ShopifyImportResult, { ok: false }>;

/** Most domain moves (apex to www, myshopify.com to a custom domain) are one hop. */
const MAX_HOST_HOPS = 2;

function outboundPath(target: ImportTarget): string {
  return target.kind === "product"
    ? `/products/${target.handle}.json`
    : `/products.json?limit=${MAX_IMPORT_PRODUCTS}`;
}

/**
 * A redirect we can follow is a pure domain move: same path and query on a
 * different host that itself passes validation. Anything else (Shopify sends
 * locked stores to /password) is treated as unavailable.
 */
function redirectHost(location: string | null, outbound: string): string | null {
  if (!location) return null;
  try {
    const from = new URL(outbound);
    const to = new URL(location, outbound);
    if (to.protocol !== "https:" || to.username || to.password) return null;
    if (to.port && to.port !== "443") return null;
    if (to.pathname !== from.pathname || to.search !== from.search) return null;
    const host = to.hostname.toLowerCase();
    if (host === from.hostname || isBlockedHostname(host)) return null;
    return host;
  } catch {
    return null;
  }
}

async function readCapped(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

async function fetchShopifyJson(host: string, target: ImportTarget): Promise<FetchOutcome> {
  const outbound = `https://${host}${outboundPath(target)}`;
  const kind = target.kind;
  let response: Response;
  try {
    response = await fetch(outbound, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        accept: "application/json",
        "user-agent": "ReferRail product import",
      },
    });
  } catch {
    return fail(502, MESSAGES.unreachable);
  }

  const status = response.status;
  if (status >= 300 && status < 400) {
    await response.body?.cancel().catch(() => undefined);
    const next = redirectHost(response.headers.get("location"), outbound);
    return next ? { ok: false, redirectHost: next } : fail(422, MESSAGES.locked);
  }
  if (status === 401 || status === 403 || status === 0) {
    await response.body?.cancel().catch(() => undefined);
    return fail(422, MESSAGES.locked);
  }
  if (status === 429) {
    await response.body?.cancel().catch(() => undefined);
    return fail(429, MESSAGES.rateLimited);
  }
  if (status === 404) {
    await response.body?.cancel().catch(() => undefined);
    return kind === "product" ? fail(404, MESSAGES.notFound) : fail(422, MESSAGES.notShopify);
  }
  if (status >= 500) {
    await response.body?.cancel().catch(() => undefined);
    return fail(502, MESSAGES.unreachable);
  }
  if (status !== 200) {
    await response.body?.cancel().catch(() => undefined);
    return fail(422, MESSAGES.notShopify);
  }

  let text: string | null;
  try {
    text = await readCapped(response);
  } catch {
    return fail(502, MESSAGES.unreachable);
  }
  if (text === null) return fail(502, MESSAGES.tooLarge);
  try {
    return { ok: true, json: JSON.parse(text) as unknown };
  } catch {
    return fail(422, MESSAGES.notShopify);
  }
}

// ---------------------------------------------------------------------------
// Product normalisation

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  bull: "•",
  middot: "·",
  trade: "™",
  reg: "®",
  copy: "©",
  deg: "°",
};

function decodeEntities(value: string): string {
  // Single pass, so "&amp;lt;" becomes "&lt;" and is not decoded twice.
  return value.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (whole, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      const valid =
        Number.isFinite(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
      return valid ? String.fromCodePoint(code) : "";
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

/** Longest HTML we will strip; descriptions are cut to 1,500 chars afterwards anyway. */
const MAX_HTML_INPUT_CHARS = 100_000;

export function htmlToPlainText(html: string, maxChars = MAX_DESCRIPTION_CHARS): string {
  // Every pattern lets an unclosed construct swallow the rest of the input (`|$`), so each
  // opener is scanned at most once and stripping stays linear even on hostile markup.
  const input = html.slice(0, MAX_HTML_INPUT_CHARS);
  const withoutBlocks = input
    .replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
    .replace(/<(script|style|noscript|template|iframe|svg)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, " ");
  const withoutTags = withoutBlocks.replace(/<\/?[a-z!][^>]*(?:>|$)/gi, " ").replace(/[<>]/g, " ");
  const text = decodeEntities(withoutTags)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b\u2028\u2029\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return truncateChars(text, maxChars);
}

function truncateChars(value: string, maxChars: number): string {
  const chars = Array.from(value);
  if (chars.length <= maxChars) return value;
  return `${chars.slice(0, maxChars - 1).join("").trimEnd()}…`;
}

function truncateBytes(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).length <= maxBytes) return value;
  const budget = maxBytes - encoder.encode("…").length;
  let out = "";
  let used = 0;
  for (const char of value) {
    const size = encoder.encode(char).length;
    if (used + size > budget) break;
    out += char;
    used += size;
  }
  return `${out.trimEnd()}…`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalisePrice(value: unknown): string | null {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  return /^\d{1,12}(\.\d{1,6})?$/.test(raw) ? raw : null;
}

function pickPrice(variants: unknown): string | null {
  if (!Array.isArray(variants)) return null;
  const records = variants.map(asRecord).filter((v): v is Record<string, unknown> => v !== null);
  const available = records.find((v) => v.available !== false && normalisePrice(v.price) !== null);
  const chosen = available ?? records.find((v) => normalisePrice(v.price) !== null);
  return chosen ? normalisePrice(chosen.price) : null;
}

function pickImage(product: Record<string, unknown>): string | null {
  const candidates: unknown[] = [asRecord(product.image)?.src];
  if (Array.isArray(product.images)) candidates.push(...product.images.map((img) => asRecord(img)?.src));
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const src = candidate.startsWith("//") ? `https:${candidate}` : candidate;
    if (isSafeHttpsUrl(src)) return src;
  }
  return null;
}

function normaliseProduct(value: unknown, host: string): ImportedProduct | null {
  const product = asRecord(value);
  if (!product) return null;
  const handle = typeof product.handle === "string" ? product.handle : "";
  if (!HANDLE_PATTERN.test(handle)) return null;
  const rawTitle = typeof product.title === "string" ? product.title : "";
  const title = truncateBytes(htmlToPlainText(rawTitle.slice(0, 1_000), 500), MAX_TITLE_BYTES);
  if (!title) return null;
  const price = pickPrice(product.variants);
  if (price === null) return null;
  const bodyHtml = typeof product.body_html === "string" ? product.body_html : "";
  return {
    title,
    description: htmlToPlainText(bodyHtml),
    price,
    imageUrl: pickImage(product),
    productUrl: `https://${host}/products/${handle}`,
    handle,
  };
}

// ---------------------------------------------------------------------------
// Entry point

/**
 * Shopify throttles /products.json per IP, so repeat imports of the same store
 * are served from a short in-memory cache (per server instance) instead of
 * hitting the store again.
 */
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_ENTRIES = 200;
const successCache = new Map<string, { at: number; result: Extract<ShopifyImportResult, { ok: true }> }>();

function cacheKey(target: ImportTarget): string {
  return `${target.kind}:${target.host}:${target.kind === "product" ? target.handle : ""}`;
}

function readCache(key: string): Extract<ShopifyImportResult, { ok: true }> | null {
  const hit = successCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    successCache.delete(key);
    return null;
  }
  return hit.result;
}

function writeCache(key: string, result: Extract<ShopifyImportResult, { ok: true }>): void {
  const now = Date.now();
  for (const [k, entry] of successCache) {
    if (now - entry.at > CACHE_TTL_MS) successCache.delete(k);
  }
  while (successCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = successCache.keys().next().value;
    if (oldest === undefined) break;
    successCache.delete(oldest);
  }
  successCache.set(key, { at: now, result });
}

export async function importShopify(rawUrl: string | null): Promise<ShopifyImportResult> {
  const target = parseImportTarget(rawUrl);
  if ("error" in target) return fail(400, target.error);
  const key = cacheKey(target);
  const cached = readCache(key);
  if (cached) return cached;

  let host = target.host;
  let json: unknown;
  for (let hop = 0; ; hop += 1) {
    const publicHost = await resolvesToPublicAddress(host);
    if (publicHost === null) return fail(502, MESSAGES.unreachable);
    if (!publicHost) return fail(400, MESSAGES.blockedHost);

    const fetched = await fetchShopifyJson(host, target);
    if (fetched.ok) {
      json = fetched.json;
      break;
    }
    if (!("redirectHost" in fetched)) return fetched;
    if (hop + 1 >= MAX_HOST_HOPS) return fail(422, MESSAGES.locked);
    host = fetched.redirectHost;
  }

  const root = asRecord(json);
  let rawProducts: unknown[];
  if (target.kind === "product") {
    const single = root ? asRecord(root.product) : null;
    if (!single) return fail(422, MESSAGES.notShopify);
    rawProducts = [single];
  } else {
    if (!root || !Array.isArray(root.products)) return fail(422, MESSAGES.notShopify);
    rawProducts = root.products.slice(0, MAX_IMPORT_PRODUCTS);
  }

  const products = rawProducts
    .map((product) => normaliseProduct(product, host))
    .filter((product): product is ImportedProduct => product !== null);
  if (!products.length) {
    return target.kind === "product" ? fail(422, MESSAGES.notShopify) : fail(422, MESSAGES.noProducts);
  }
  const result: Extract<ShopifyImportResult, { ok: true }> = { ok: true, store: host, products };
  writeCache(key, result);
  return result;
}
