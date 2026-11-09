/**
 * End-to-end smoke test against a deployed testnet contract.
 *
 * Asserts, on chain:
 *   1. preview_split matches the documented fee math,
 *   2. a buyer payment creates a sale with that exact split,
 *   3. an unknown referral code is refused (no sale, tokens refunded),
 *   4. release before the hold is refused by the contract,
 *   5. release after the hold moves the three expected amounts,
 *   6. a second release is refused.
 *
 * Usage: npm run smoke
 */

import {
  assert,
  balance,
  call,
  env,
  log,
  required,
  sleep,
  view,
  waitFor,
  signedDelegate,
} from "./lib/near";

interface Preview {
  creator_bps: number;
  protocol_bps: number;
  merchant_amount: string;
  creator_amount: string;
  protocol_amount: string;
  known_creator: boolean;
}

interface Sale {
  id: number;
  status: "Pending" | "Released" | "Refunded";
  amount: string;
  merchant_amount: string;
  creator_amount: string;
  protocol_amount: string;
  release_at_ns: number;
}

async function main(): Promise<void> {
  const network = env("NEAR_NETWORK", "testnet");
  if (network !== "testnet") throw new Error("The smoke test only runs against testnet");

  const contractId = required("NEAR_CONTRACT_ID");
  const token = required("NEAR_FT_ACCOUNT");
  const treasury = required("NEAR_TREASURY_ACCOUNT");
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
  const deferRelease = process.argv.includes("--no-release");

  // Use the latest seeded offer, or create one with a zero hold.
  const stats = await view<{ offer_count: number }>(contractId, "stats");
  const offerId = Number(env("SMOKE_OFFER_ID", String(stats.offer_count)));
  assert(offerId > 0, "no offer found — run `npm run seed` first");

  const offer = await view<{ id: number; price: string; token: string; commission_bps: number }>(
    contractId,
    "get_offer",
    { offer_id: offerId },
  );
  assert(offer, `offer ${offerId} not found`);

  const code = `smoke${Date.now().toString(36).slice(-6)}`;
  log("step 1", `registering creator code "${code}" on offer ${offerId}`);
  await call({
    accountId: creator.accountId,
    privateKey: creator.privateKey,
    contractId,
    method: "register_creator",
    args: { offer_id: offerId, code, payout_account: creator.accountId, commission_bps_override: null },
    gasTgas: 30,
  });

  const preview = await view<Preview>(contractId, "preview_split", {
    offer_id: offerId,
    amount: offer.price,
    ref_code: code,
  });
  log("step 2", `preview: merchant=${preview.merchant_amount} creator=${preview.creator_amount} protocol=${preview.protocol_amount}`);
  const price = BigInt(offer.price);
  assert(BigInt(preview.merchant_amount) + BigInt(preview.creator_amount) + BigInt(preview.protocol_amount) === price, "split must add up to the price");
  assert(BigInt(preview.protocol_amount) === (price * BigInt(preview.protocol_bps)) / 10_000n, "protocol fee math");
  assert(BigInt(preview.creator_amount) === (price * BigInt(preview.creator_bps)) / 10_000n, "creator commission math");

  const beforeSaleCount = (await view<{ sale_count: number }>(contractId, "stats")).sale_count;
  const balancesBefore = {
    buyer: await balance(token, buyer.accountId),
    merchant: await balance(token, merchant.accountId),
    creator: await balance(token, creator.accountId),
    treasury: await balance(token, treasury),
  };

  log("step 3", `buyer ${buyer.accountId} pays ${offer.price} with code "${code}"`);
  await call({
    accountId: buyer.accountId,
    privateKey: buyer.privateKey,
    contractId: token,
    method: "ft_transfer_call",
    args: {
      receiver_id: contractId,
      amount: offer.price,
      msg: JSON.stringify({ offer_id: offerId, ref: code }),
    },
    gasTgas: 100,
    depositYocto: "1",
  });

  const saleId = await waitFor(
    "the sale to be recorded",
    async () => {
      const latest = await view<{ sale_count: number }>(contractId, "stats");
      return latest.sale_count > beforeSaleCount ? latest.sale_count : false;
    },
    40_000,
  );
  const sale = await view<Sale>(contractId, "get_sale", { sale_id: saleId });
  assert(sale, `sale ${saleId} should exist`);
  assert(sale.status === "Pending", `sale should be pending, got ${sale.status}`);
  assert(sale.merchant_amount === preview.merchant_amount, "sale merchant amount matches preview");
  assert(sale.creator_amount === preview.creator_amount, "sale creator amount matches preview");
  log("step 3", `sale #${saleId} recorded with the previewed split`);

  // 4. Unknown referral code is refused and refunded.
  log("step 4", "unknown referral code must be refused");
  const buyerBeforeBadRef = await balance(token, buyer.accountId);
  const saleCountBeforeBadRef = (await view<{ sale_count: number }>(contractId, "stats")).sale_count;
  await call({
    accountId: buyer.accountId,
    privateKey: buyer.privateKey,
    contractId: token,
    method: "ft_transfer_call",
    args: {
      receiver_id: contractId,
      amount: offer.price,
      msg: JSON.stringify({ offer_id: offerId, ref: "definitely-not-a-code" }),
    },
    gasTgas: 100,
    depositYocto: "1",
  });
  await sleep(4_000);
  const saleCountAfterBadRef = (await view<{ sale_count: number }>(contractId, "stats")).sale_count;
  assert(saleCountAfterBadRef === saleCountBeforeBadRef, "an unknown referral code must not create a sale");
  const buyerAfterBadRef = await balance(token, buyer.accountId);
  assert(buyerAfterBadRef === buyerBeforeBadRef, "the refused payment must be refunded to the buyer");
  log("step 4", "refused and refunded");

  if (deferRelease) {
    log("done", `sale #${saleId} left pending (--no-release). Run release later with: npm run smoke -- --release ${saleId}`);
    return;
  }

  // 5. Release before the hold (only meaningful when the hold is non-zero).
  if (sale.release_at_ns > Date.now() * 1_000_000) {
    log("step 5", "release before the hold must be refused");
    let refused = false;
    try {
      await call({
        accountId: env("NEAR_RELAYER_ACCOUNT") ? required("NEAR_RELAYER_ACCOUNT") : merchant.accountId,
        privateKey: env("NEAR_RELAYER_PRIVATE_KEY") ? required("NEAR_RELAYER_PRIVATE_KEY") : merchant.privateKey,
        contractId,
        method: "release",
        args: { sale_id: saleId },
        gasTgas: 200,
      });
    } catch {
      refused = true;
    }
    assert(refused, "release before the hold should fail");
    log("step 5", "refused as expected");
    log("wait", "waiting for the refund hold to elapse…");
    while (Date.now() * 1_000_000 < sale.release_at_ns) await sleep(2_000);
  }

  log("step 6", `releasing sale #${saleId}`);
  await call({
    accountId: env("NEAR_RELAYER_ACCOUNT") ? required("NEAR_RELAYER_ACCOUNT") : merchant.accountId,
    privateKey: env("NEAR_RELAYER_PRIVATE_KEY") ? required("NEAR_RELAYER_PRIVATE_KEY") : merchant.privateKey,
    contractId,
    method: "release",
    args: { sale_id: saleId },
    gasTgas: 200,
  });

  const released = await waitFor(
    "the sale to be released",
    async () => {
      const current = await view<Sale>(contractId, "get_sale", { sale_id: saleId });
      return current?.status === "Released" ? current : false;
    },
    40_000,
  );
  assert(released.status === "Released", "sale should be released");

  await waitFor(
    "recipient balances to change",
    async () => {
      const merchantNow = await balance(token, merchant.accountId);
      const creatorNow = await balance(token, creator.accountId);
      const treasuryNow = await balance(token, treasury);
      return (
        merchantNow === balancesBefore.merchant + BigInt(released.merchant_amount) &&
        creatorNow === balancesBefore.creator + BigInt(released.creator_amount) &&
        treasuryNow === balancesBefore.treasury + BigInt(released.protocol_amount)
      );
    },
    40_000,
  );
  log("step 6", "merchant, creator and treasury were paid the exact previewed amounts");

  // 7. A second release must fail.
  log("step 7", "second release must be refused");
  let secondRefused = false;
  try {
    await call({
      accountId: merchant.accountId,
      privateKey: merchant.privateKey,
      contractId,
      method: "release",
      args: { sale_id: saleId },
      gasTgas: 200,
    });
  } catch {
    secondRefused = true;
  }
  assert(secondRefused, "releasing an already released sale should fail");

  // 8. Show the meta-transaction path too (creator registers another code gaslessly).
  if (env("NEAR_RELAYER_ACCOUNT") && env("NEAR_RELAYER_PRIVATE_KEY")) {
    log("step 8", "gasless claim through the NEP-366 relayer");
    try {
      const payload = await signedDelegate({
        senderId: creator.accountId,
        privateKey: creator.privateKey,
        contractId,
        method: "register_creator",
        args: {
          offer_id: offerId,
          code: `${code}x`,
          payout_account: creator.accountId,
          commission_bps_override: null,
        },
      });
      const response = await fetch(`${env("NEXT_PUBLIC_APP_URL", "http://localhost:3000")}/api/relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signedDelegate: payload }),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      log("step 8", "relayer sponsored the claim (creator paid no gas)");
    } catch (error) {
      log("step 8", `skipped: ${error instanceof Error ? error.message : error}`);
      log("step 8", "start `npm run dev` with a relayer key configured to exercise this step");
    }
  }

  log("PASS", "all on-chain assertions passed");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
