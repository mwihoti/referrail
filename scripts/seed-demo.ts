/**
 * Seed a testnet demo.
 *
 * Prerequisites (README "Configure"):
 *   - contracts deployed: `scripts/deploy-testnet.sh`
 *   - apps/web/.env.local filled in with throwaway testnet keys
 *
 * What it does:
 *   1. registers the merchant, creator, treasury and the escrow contract on the
 *      demo NEP-141 token (storage deposits),
 *   2. mints demo tokens to the buyer,
 *   3. creates the demo offer as the merchant,
 *   4. registers the creator's referral code,
 *   5. prints the buyer link and the env block the web app needs.
 *
 * Usage: npm run seed            (safe to re-run; it creates a new offer each time)
 *        npm run seed -- --write-env
 */

import {
  assert,
  balance,
  call,
  env,
  log,
  required,
  view,
} from "./lib/near";

const FT_STORAGE_DEPOSIT = "1250000000000000000000"; // 0.00125 NEAR per NEP-145 registration

interface Offer {
  id: number;
  price: string;
  commission_bps: number;
  merchant: string;
  title: string;
}

async function registerTokenAccount(
  token: string,
  payer: { accountId: string; privateKey: string },
  accountId: string,
): Promise<void> {
  const existing = (await view<unknown>(token, "storage_balance_of", { account_id: accountId })) as
    | string
    | null;
  if (existing) {
    log("ft", `${accountId} already registered`);
    return;
  }
  log("ft", `registering ${accountId} on ${token}`);
  await call({
    accountId: payer.accountId,
    privateKey: payer.privateKey,
    contractId: token,
    method: "storage_deposit",
    args: { account_id: accountId },
    depositYocto: FT_STORAGE_DEPOSIT,
    gasTgas: 30,
  });
}

async function main(): Promise<void> {
  const writeEnv = process.argv.includes("--write-env");
  const network = env("NEAR_NETWORK", "testnet");
  if (network !== "testnet") throw new Error("The seed script refuses to run on mainnet");

  const contractId = required("NEAR_CONTRACT_ID");
  const token = required("NEAR_FT_ACCOUNT");
  const decimals = Number(env("NEAR_FT_DECIMALS", "6"));
  const treasury = required("NEAR_TREASURY_ACCOUNT");

  const deployer = {
    accountId: required("NEAR_DEPLOYER_ACCOUNT"),
    privateKey: required("NEAR_DEPLOYER_PRIVATE_KEY"),
  };
  const merchant = {
    accountId: required("NEAR_BIZ_ACCOUNT"),
    privateKey: required("NEAR_BIZ_PRIVATE_KEY"),
  };
  const creator = {
    accountId: required("NEAR_CREATOR_ACCOUNT"),
    privateKey: required("NEAR_CREATOR_PRIVATE_KEY"),
  };
  const buyer = {
    accountId: required("NEAR_BUYER_ACCOUNT"),
    privateKey: required("NEAR_BUYER_PRIVATE_KEY"),
  };
  const relayerAccount = env("NEAR_RELAYER_ACCOUNT", "rr-relayer.testnet");

  // 1. NEP-145 registrations so `release` can pay everyone.
  for (const accountId of [merchant.accountId, creator.accountId, treasury, contractId]) {
    await registerTokenAccount(token, deployer, accountId);
  }

  // 2. Fund the buyer with demo tokens.
  const buyerBalance = await balance(token, buyer.accountId);
  const wanted = 100n * 10n ** BigInt(decimals);
  if (buyerBalance < wanted) {
    const amount = (wanted - buyerBalance).toString();
    log("mint", `minting ${amount} to ${buyer.accountId}`);
    await call({
      accountId: deployer.accountId,
      privateKey: deployer.privateKey,
      contractId: token,
      method: "mint",
      args: { account_id: buyer.accountId, amount },
      gasTgas: 30,
    });
  } else {
    log("mint", `buyer already holds ${buyerBalance.toString()}`);
  }

  // 3. Publish the demo offer (price in whole tokens → smallest units).
  const priceWhole = env("SEED_PRICE", "10");
  const [wholePart, fractionPart = ""] = priceWhole.split(".");
  const priceSmallest = BigInt(`${wholePart}${(fractionPart + "0".repeat(decimals)).slice(0, decimals)}`);
  const holdHours = Number(env("SEED_HOLD_HOURS", "0"));
  const commissionBps = Number(env("SEED_COMMISSION_BPS", "1500"));

  log("offer", `creating offer as ${merchant.accountId}`);
  await call({
    accountId: merchant.accountId,
    privateKey: merchant.privateKey,
    contractId,
    method: "create_offer",
    args: {
      title: env("SEED_TITLE", "Yoga class · 60 minutes"),
      description: env(
        "SEED_DESCRIPTION",
        "Live online class. Buyer pays into escrow; the creator commission is paid when the sale settles.",
      ),
      token,
      price: priceSmallest.toString(),
      commission_bps: commissionBps,
      refund_hold_ns: Math.round(holdHours * 3_600_000_000_000),
      allowed_creators: null,
      payout_account: merchant.accountId,
      intents_dest: null,
    },
    gasTgas: 60,
  });

  const stats = await view<{ offer_count: number }>(contractId, "stats");
  const offerId = stats.offer_count;
  const offer = await view<Offer>(contractId, "get_offer", { offer_id: offerId });
  assert(offer, `offer ${offerId} should exist after create_offer`);

  // 4. Register the creator's code.
  const code = env("SEED_REF_CODE", "ada");
  log("creator", `registering code "${code}" for ${creator.accountId}`);
  await call({
    accountId: creator.accountId,
    privateKey: creator.privateKey,
    contractId,
    method: "register_creator",
    args: {
      offer_id: offerId,
      code,
      payout_account: creator.accountId,
      commission_bps_override: null,
    },
    gasTgas: 30,
  });

  const link = await view<unknown>(contractId, "get_creator", { offer_id: offerId, code });
  assert(link, "creator link should exist after register_creator");

  const appUrl = env("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  const buyerLink = `${appUrl}/offer/${offerId}?ref=${code}`;

  log("done", `offer #${offerId} · ${offer.title} · price ${offer.price} (${decimals} decimals)`);
  console.log(`
Buyer link:      ${buyerLink}
Creator page:    ${appUrl}/creator
Ledger:          ${appUrl}/ledger
Explorer:        https://testnet.nearblocks.io/address/${contractId}

Paste into apps/web/.env.local (or re-run with --write-env):

DEMO_MODE=yes
DEMO_MERCHANT_ACCOUNT=${merchant.accountId}
DEMO_MERCHANT_PRIVATE_KEY=${merchant.privateKey}
DEMO_CREATOR_ACCOUNT=${creator.accountId}
DEMO_CREATOR_PRIVATE_KEY=${creator.privateKey}
DEMO_BUYER_ACCOUNT=${buyer.accountId}
DEMO_BUYER_PRIVATE_KEY=${buyer.privateKey}
FT_OWNER_ACCOUNT=${deployer.accountId}
FT_OWNER_PRIVATE_KEY=${deployer.privateKey}
NEAR_RELAYER_ACCOUNT=${relayerAccount}
`);

  if (writeEnv) {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const target = path.resolve(process.cwd(), "apps/web/.env.local");
    const block = [
      "DEMO_MODE=yes",
      `DEMO_MERCHANT_ACCOUNT=${merchant.accountId}`,
      `DEMO_MERCHANT_PRIVATE_KEY=${merchant.privateKey}`,
      `DEMO_CREATOR_ACCOUNT=${creator.accountId}`,
      `DEMO_CREATOR_PRIVATE_KEY=${creator.privateKey}`,
      `DEMO_BUYER_ACCOUNT=${buyer.accountId}`,
      `DEMO_BUYER_PRIVATE_KEY=${buyer.privateKey}`,
      `FT_OWNER_ACCOUNT=${deployer.accountId}`,
      `FT_OWNER_PRIVATE_KEY=${deployer.privateKey}`,
      "",
    ].join("\n");
    const existing = await fs.readFile(target, "utf8").catch(() => "");
    await fs.writeFile(target, `${existing.trimEnd()}\n\n${block}`);
    log("env", `appended demo keys to ${target}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
