import { config as loadEnv } from "dotenv";
import path from "node:path";
import {
  Account,
  JsonRpcProvider,
  actions,
  encodeSignedDelegate,
  teraToGas,
  type KeyPairString,
} from "near-api-js";

loadEnv({ path: path.resolve(process.cwd(), "apps/web/.env.local"), quiet: true });
loadEnv({ quiet: true });

export function env(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export function required(name: string): string {
  const value = env(name);
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to apps/web/.env.local and fill it in (see README "Configure").`,
    );
  }
  return value;
}

export function rpcUrl(): string {
  return env("NEAR_RPC_URL", "https://test.rpc.fastnear.com");
}

let cached: JsonRpcProvider | null = null;
export function provider(): JsonRpcProvider {
  if (!cached) cached = new JsonRpcProvider({ url: rpcUrl() });
  return cached;
}

export function account(accountId: string, privateKey: string): Account {
  return new Account(accountId, provider(), privateKey as KeyPairString);
}

export async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await provider().callFunction({ contractId, method, args })) as T;
}

export interface CallParams {
  accountId: string;
  privateKey: string;
  contractId: string;
  method: string;
  args?: Record<string, unknown>;
  gasTgas?: number;
  depositYocto?: string;
}

export async function call(params: CallParams): Promise<{ hash: string; outcome: unknown }> {
  const signer = account(params.accountId, params.privateKey);
  const outcome = (await signer.signAndSendTransaction({
    receiverId: params.contractId,
    actions: [
      actions.functionCall(
        params.method,
        params.args ?? {},
        teraToGas(params.gasTgas ?? 50),
        BigInt(params.depositYocto ?? "0"),
      ),
    ],
  })) as { transaction?: { hash?: string } };
  const hash = outcome?.transaction?.hash ?? "unknown";
  return { hash, outcome };
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor<T>(
  label: string,
  fn: () => Promise<T | null | undefined | false>,
  timeoutMs = 30_000,
  intervalMs = 1_000,
): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export async function balance(tokenId: string, accountId: string): Promise<bigint> {
  const result = (await view<unknown>(tokenId, "ft_balance_of", { account_id: accountId })) as
    | string
    | { "0"?: string }
    | number;
  const raw = typeof result === "string" ? result : typeof result === "number" ? String(result) : result?.["0"];
  return BigInt(raw ?? "0");
}

/** Build a base64 NEP-366 SignedDelegateAction for POST /api/relay. */
export async function signedDelegate(params: {
  senderId: string;
  privateKey: string;
  contractId: string;
  method: string;
  args: Record<string, unknown>;
  gasTgas?: number;
  ttlBlocks?: number;
}): Promise<string> {
  const signer = account(params.senderId, params.privateKey);
  const { signedDelegate: delegate } = await signer.createSignedMetaTransaction({
    receiverId: params.contractId,
    actions: [
      actions.functionCall(params.method, params.args, teraToGas(params.gasTgas ?? 25), 0n),
    ],
    blockHeightTtl: params.ttlBlocks ?? 120,
  });
  return Buffer.from(encodeSignedDelegate(delegate)).toString("base64");
}

export function log(step: string, message: string): void {
  console.log(`[${step}] ${message}`);
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}
