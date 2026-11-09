import {
  Account,
  JsonRpcProvider,
  MultiKeySigner,
  SCHEMA,
  actions,
  encodeSignedDelegate,
  teraToGas,
  type KeyPairString,
  type SignedDelegate,
} from "near-api-js";
import { deserialize } from "borsh";
import { relayerKeys, serverConfig } from "@/lib/config";
import { provider } from "@/lib/near/server";

/**
 * Server-side signing helpers. Private keys stay on the server: they are either
 * the relayer's own key (sending `release`) or seeded throwaway demo personas.
 */

function accountFor(accountId: string, privateKey: string): Account {
  return new Account(accountId, provider(), privateKey as KeyPairString);
}

export async function callContract(params: {
  accountId: string;
  privateKey: string;
  method: string;
  args: Record<string, unknown>;
  gasTgas?: number;
  depositYocto?: string;
}): Promise<unknown> {
  const { contractId } = serverConfig();
  if (!contractId) throw new Error("NEAR_CONTRACT_ID is not configured");
  const account = accountFor(params.accountId, params.privateKey);
  return account.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      actions.functionCall(
        params.method,
        params.args,
        teraToGas(params.gasTgas ?? 50),
        BigInt(params.depositYocto ?? "0"),
      ),
    ],
  });
}

export async function callToken(params: {
  accountId: string;
  privateKey: string;
  method: string;
  args: Record<string, unknown>;
  gasTgas?: number;
  depositYocto?: string;
}): Promise<unknown> {
  const { ftAccount } = serverConfig();
  if (!ftAccount) throw new Error("NEAR_FT_ACCOUNT is not configured");
  const account = accountFor(params.accountId, params.privateKey);
  return account.signAndSendTransaction({
    receiverId: ftAccount,
    actions: [
      actions.functionCall(
        params.method,
        params.args,
        teraToGas(params.gasTgas ?? 50),
        BigInt(params.depositYocto ?? "0"),
      ),
    ],
  });
}

/** Buyer pays an offer: `ft_transfer_call` into escrow with `{"offer_id":n,"ref":"code"}`. */
export async function payOffer(params: {
  buyerAccount: string;
  buyerPrivateKey: string;
  offerId: number;
  refCode: string | null;
  price: string;
}): Promise<unknown> {
  const msg = JSON.stringify({
    offer_id: params.offerId,
    ...(params.refCode ? { ref: params.refCode } : {}),
  });
  return callToken({
    accountId: params.buyerAccount,
    privateKey: params.buyerPrivateKey,
    method: "ft_transfer_call",
    args: {
      receiver_id: serverConfig().contractId,
      amount: params.price,
      msg,
    },
    gasTgas: 100,
    depositYocto: "1",
  });
}

/** Build a NEP-366 SignedDelegateAction, base64-encoded for POST /api/relay. */
export async function createSignedDelegate(params: {
  senderId: string;
  privateKey: string;
  method: string;
  args: Record<string, unknown>;
  gasTgas?: number;
  depositYocto?: string;
  ttlBlocks?: number;
}): Promise<string> {
  const { contractId } = serverConfig();
  if (!contractId) throw new Error("NEAR_CONTRACT_ID is not configured");
  const account = accountFor(params.senderId, params.privateKey);
  const { signedDelegate } = await account.createSignedMetaTransaction({
    receiverId: contractId,
    actions: [
      actions.functionCall(
        params.method,
        params.args,
        teraToGas(params.gasTgas ?? 30),
        BigInt(params.depositYocto ?? "0"),
      ),
    ],
    blockHeightTtl: params.ttlBlocks ?? 120,
  });
  return Buffer.from(encodeSignedDelegate(signedDelegate)).toString("base64");
}

export function decodeSignedDelegate(base64: string): SignedDelegate {
  const bytes = Buffer.from(base64, "base64");
  return deserialize(SCHEMA.SignedDelegate, bytes) as unknown as SignedDelegate;
}

/** Submit a signed delegate using the relayer's funded account(s). */
export async function relaySignedDelegate(base64: string): Promise<unknown> {
  const relayer = relayerKeys();
  if (!relayer) throw new Error("Relayer is not configured (NEAR_RELAYER_ACCOUNT / _PRIVATE_KEY)");
  const signer =
    relayer.keys.length === 1
      ? (relayer.keys[0] as KeyPairString)
      : MultiKeySigner.fromSecretKeys(relayer.keys as KeyPairString[]);
  const relayerAccount = new Account(relayer.account, provider(), signer);
  const signedDelegate = decodeSignedDelegate(base64);
  return relayerAccount.relayMetaTransaction(signedDelegate);
}

/**
 * Only sponsor `register_creator` calls to our own contract: no deposits, and a
 * gas ceiling. This is the relayer's entire attack surface.
 */
export function validateSponsorableDelegate(signedDelegate: SignedDelegate): {
  ok: boolean;
  reason?: string;
  senderId?: string;
} {
  const { contractId } = serverConfig();
  const delegate = signedDelegate.delegateAction;
  if (!delegate) return { ok: false, reason: "Malformed delegate action" };
  if (delegate.receiverId !== contractId) {
    return { ok: false, reason: `Refusing to relay to ${delegate.receiverId}` };
  }
  const list = delegate.actions ?? [];
  if (list.length !== 1) return { ok: false, reason: "Exactly one action is allowed" };
  const action = list[0];
  const fnCall = action?.functionCall;
  if (!fnCall) return { ok: false, reason: "Only FunctionCall actions are sponsored" };
  if (fnCall.methodName !== "register_creator") {
    return { ok: false, reason: `Method ${fnCall.methodName} is not sponsored` };
  }
  if (BigInt(fnCall.deposit ?? "0") !== 0n) {
    return { ok: false, reason: "Attached deposits are not sponsored" };
  }
  if (BigInt(fnCall.gas ?? "0") > 30_000_000_000_000n) {
    return { ok: false, reason: "Gas above the 30 Tgas sponsorship cap" };
  }
  return { ok: true, senderId: delegate.senderId };
}

export { JsonRpcProvider };
