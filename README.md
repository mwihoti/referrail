# ReferRail NEAR

**Pay-on-sale referrals on NEAR.** A business publishes an offer with a creator commission. Every
creator gets a unique link. A buyer pays, the contract escrows the token, and after the refund hold
the sale is split **merchant / creator / protocol** — atomically, on chain. Creators claim links
without buying gas, and an agent drafts the commission rules without ever holding spending keys.

Built at **NEAR HACKATHON** (1–14 November 2026). Tracks: `realworld`, `agents`, `business`.

- **Problem:** businesses won't pay commission before a sale; creators won't invoice after the fact.
- **Same chain, one call:** escrow → hold → refundable → split. No database holds the money.
- **Cross-chain:** each party can route their share onward through **NEAR Intents (1Click)** to a
  chain they already use. Intents has no testnet, so that module is labelled and dry by default.

---

## What is in this repository

| Path | What it is |
|---|---|
| `contracts/referrail` | Rust (`near-sdk` 5.30) escrow + split contract. NEP-141 receiver, per-creator codes, allow-lists, refunds, permissionless release, per-sale economics snapshot. |
| `contracts/test-ft` | Minimal NEP-141 test token (`tUSDC`) so the demo never depends on a third-party fake-USDT account. Testnet only. |
| `apps/web` | Next.js 16 app: landing + offers, business console with the agent, buyer pay screen, creator claim, public ledger, `/api/health`. |
| `apps/web/app/api/relay` | NEP-366 meta-transaction relayer. Sponsors **only** `register_creator` on this contract. |
| `apps/web/lib/intents.ts` | 1Click client: live token list, `dry: true` quotes, status proxy. Mainnet module. |
| `scripts/` | Deploy, seed, on-chain smoke test, CLI relayer client. |
| `DISCLOSURE.md` | Prior work on other chains (Celo, PayPal) and exactly what is new here. |

---

## How the money moves

1. **Publish.** Merchant calls `create_offer(title, token, price, commission_bps, refund_hold_ns,
   payout_account, …)`. The protocol fee is snapshotted onto the offer.
2. **Claim.** Creator calls `register_creator(offer_id, code)`. No deposit, so a NEP-366 delegate or a
   function-call key can submit it. Identity is `predecessor_account_id`, so the relayer never becomes
   the referrer.
3. **Pay.** Buyer calls the token's `ft_transfer_call` with `msg = {"offer_id":1,"ref":"ada"}`.
   The contract checks token, exact price, pause state and code, then records a `Sale` with the split
   **snapshotted** — later offer edits cannot change an in-flight sale.
4. **Settle.** Before the hold, the merchant can `refund` (full amount back to the buyer). After the
   hold, **anyone** can call `release`, which pays merchant, creator and treasury with three
   `ft_transfer` calls.

Fee math (integer only, asserted in tests):

```text
protocol = amount * protocol_bps / 10_000      # protocol fee capped at 2%
creator  = amount * creator_bps  / 10_000      # 0 when no referral code
merchant = amount - protocol - creator
require(creator_bps + protocol_bps < 10_000)   # enforced at offer creation and claim
```

Example asserted in `split_math_matches_spec`: 10.000000 tokens, 15% creator, 2% protocol →
creator `1_500_000`, protocol `200_000`, merchant `8_300_000`.

---

## Quick start

### 0. Prerequisites

- **Node 22+** (the official NEAR JS examples specify 22.22.2 or newer)
- **Rust** with `wasm32-unknown-unknown`, plus **cargo-near** and **near-cli-rs**

```bash
rustup target add wasm32-unknown-unknown
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/cargo-near/releases/latest/download/cargo-near-installer.sh | sh
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/near-cli-rs/releases/latest/download/near-cli-rs-installer.sh | sh
```

### 1. Contract tests (no network, ~1 minute)

```bash
cd contracts/referrail && cargo test
```

**Expect:** `all tests passed` — 20 tests covering the fee math, no-referral split, oversized
commission, wrong amount/token, unknown code refunds, refund-then-second-refund panic, hold gating,
double release, paused offers, allow-lists, duplicate codes, economics snapshotting and the
creator-sales index.

```bash
cd ../test-ft && cargo test
```

**Expect:** 4 tests covering transfers, the 1-yoctoNEAR rule, unregistered recipients and owner-only minting.

### 2. Configure

```bash
npm install                     # root workspace (web app + scripts)
cp .env.example apps/web/.env.local
```

Fill `apps/web/.env.local` with **throwaway testnet** accounts. Create them with the faucet:

```bash
near create-account referrail-dev.testnet --useFaucet
near create-account rr-biz.testnet --useFaucet
near create-account rr-creator.testnet --useFaucet
near create-account rr-buyer.testnet --useFaucet
near create-account rr-relayer.testnet --useFaucet
```

Never put a mainnet payout key in this file. `.env.local` is gitignored.

### 3. Deploy the contracts (testnet)

```bash
NEAR_ACCOUNT=referrail-dev.testnet \
NEAR_FT_ACCOUNT=usdc.referrail-dev.testnet \
NEAR_TREASURY_ACCOUNT=referrail-dev.testnet \
./scripts/deploy-testnet.sh
```

The script builds both contracts with `cargo near build`, deploys + initialises the escrow (2% fee),
deploys the demo token, and whitelists the token on the escrow. It refuses to run unless
`NEAR_NETWORK=testnet`.

### 4. Seed the demo

```bash
npm run seed -- --write-env
```

It registers the merchant, creator, treasury and escrow contract on the token (NEP-145 storage),
funds the buyer with 100 `tUSDC`, creates the offer, registers the creator code `ada`, and appends the
demo signing keys to `apps/web/.env.local`.

### 5. Run

```bash
npm run dev            # http://localhost:3000
```

---

## Try it — "do X → see Y"

You can do all of this **without a wallet extension**: `DEMO_MODE=yes` plus the seeded personas lets
the server sign the seeded actions. Every screen also works with a real NEAR wallet through NEAR
Connect; the wallet path is the one a real merchant would use.

1. **Open `http://localhost:3000`.**
   *Expect:* the seeded offer card, price `10 tUSDC`, "15% to creators".
2. **Go to `/business`.** In the agent box, keep the sentence and click **Draft with agent**.
   *Expect:* title, price, 15% commission, 0-hour hold, plus a note saying whether the LLM or the
   deterministic parser ran.
3. **Click Publish.**
   *Expect:* a notice with the transaction (demo merchant, or your wallet) and a new offer row below.
4. **Go to `/creator`,** pick the offer, keep code `ada`, click **Claim gaslessly**.
   *Expect:* a green notice saying the relayer paid the gas (mode `meta-tx`) and a copyable link
   `/offer/<id>?ref=ada`. No NEAR was deducted from the creator.
5. **Open that link.** The split preview shows merchant / creator / protocol.
   *Expect:* 8.5 / 1.5 / 0.2 `tUSDC` for a 10 `tUSDC` sale.
6. **Click Pay as demo buyer.**
   *Expect:* a sale card appears (`Pending`), then **Release the split now** becomes available
   because the seed uses a 0-hour hold.
7. **Click Release.**
   *Expect:* status `Released`, and `/ledger` shows the three amounts. Each row is read from
   `get_sale`; open the transaction in the explorer to see the three `ft_transfer` receipts.
8. **Go to `/intents`,** leave the pair as ETH USDC → NEAR USDT (both from the live token list), keep the
   `example.near` recipient and the `0x…` refund address, click **Get quote**.
   *Expect:* a dry 1Click quote (JSON) with a note that no deposit address was created and nothing
   was spent. Some corridors return a 1Click server error; pick another pair from the same lists.
9. **Open `/api/health`.**
   *Expect:* contract reachable, protocol fee, relayer configured `true`, demo mode `true`, agent
   provider, and the Intents note that it is mainnet-only.

Optional gasless proof from the CLI (with `npm run dev` running):

```bash
npm run relay-client -- <offerId> <newCode>
```

---

## Environment variables

| Variable | Purpose |
|---|---|
| `NEAR_NETWORK`, `NEAR_RPC_URL` | `testnet` + a documented public RPC (`https://test.rpc.fastnear.com`). |
| `NEAR_CONTRACT_ID` | Escrow contract account. |
| `NEAR_FT_ACCOUNT`, `NEAR_FT_DECIMALS`, `NEAR_FT_SYMBOL` | Demo token + display units. |
| `NEAR_TREASURY_ACCOUNT` | Receives the protocol fee. |
| `NEAR_RELAYER_ACCOUNT`, `NEAR_RELAYER_PRIVATE_KEY` / `NEAR_RELAYER_PRIVATE_KEYS` | Funded relayer that submits meta transactions and `release`. `_KEYS` is a JSON array for nonce isolation. |
| `DEMO_MODE` | `yes` enables the seeded demo signing routes. Off by default. |
| `DEMO_MERCHANT_*`, `DEMO_CREATOR_*`, `DEMO_BUYER_*` | Throwaway testnet keys for the seeded personas. |
| `FT_OWNER_ACCOUNT`, `FT_OWNER_PRIVATE_KEY` | Owner of the demo token, used by the `/api/demo/faucet` route (testnet only). |
| `NEAR_AI_BASE_URL`, `NEAR_AI_API_KEY`, `NEAR_AI_MODEL` | NEAR AI Cloud (OpenAI-compatible). Empty key → deterministic fallback. |
| `INTENTS_API_BASE`, `INTENTS_JWT` | 1Click endpoint and optional partner JWT (`X-API-Key` / `Bearer`). |
| `CONFIRM_LIVE_INTENTS` | `no` by default. `yes` allows live mainnet quotes when the UI also opts in. |
| `NEXT_PUBLIC_NEAR_NETWORK`, `NEXT_PUBLIC_NEAR_CONTRACT_ID`, `NEXT_PUBLIC_APP_URL` | Browser-visible values. |

Server-only keys are read in route handlers and never shipped to the browser.

---

## Contract API (`contracts/referrail`)

**Admin** — `set_paused`, `whitelist_token`, `remove_token`, `set_treasury`, `set_protocol_fee_bps`
(capped at 200 bps; applies to new offers only).

**Business** — `create_offer`, `update_offer`, `pause_offer`, `refund`.

**Creators** — `register_creator(offer_id, code, payout_account?, commission_bps_override?)`.
No deposit, so it is meta-transaction friendly. One link per creator per offer; re-claiming replaces
the code.

**Buying** — `ft_on_transfer(sender_id, amount, msg)`. Returns `0` to accept, or the full amount to
refuse (unknown offer, wrong token, wrong amount, paused offer, unknown code).

**Settlement** — `release(sale_id)`: permissionless once the hold has elapsed; pays the three parties
and attaches the 1-yoctoNEAR `ft_transfer` deposits from the contract's own balance.

**Views** — `get_config`, `get_offer`, `list_offers`, `get_sale`, `list_sales`, `list_sales_by_offer`,
`list_sales_by_creator`, `get_creator`, `get_creator_by_account`, `preview_split`, `stats`.

---

## The agent

- **Drafts** an offer from a sentence (title, price, commission, hold, payout account).
- **Matches** 2–3 creators from `apps/web/data/creators.json`, with an explicit reason per match.
- **Cannot** call any fund path: it returns JSON. The merchant publishes from their wallet; release
  and refund stay in the contract. The agent holds no NEAR key in this repository.
- Inference: NEAR AI Cloud when `NEAR_AI_API_KEY` is set, otherwise a deterministic parser so the demo
  works without credits. The UI always shows which one produced the draft.

## The relayer

`POST /api/relay` accepts `{ signedDelegate: base64(borsh SignedDelegateAction) }`, then:

1. decodes it with `borsh` + `SCHEMA.SignedDelegate`,
2. rejects anything except **one** `FunctionCall` to this contract's `register_creator`, with zero
   attached deposit and ≤30 Tgas,
3. submits it through `relayMetaTransaction` using the relayer's funded account.

The creator signs; the relayer pays gas; the contract credits `predecessor_account_id`, i.e. the
creator. `release` is sent by the relayer *as itself* because `ft_transfer` needs 1 yoctoNEAR attached,
which a function-call key cannot do.

## NEAR Intents (mainnet module)

`/intents` loads the live `GET /v0/tokens` list (cached 10 minutes), never a hard-coded chain list.
`POST /v0/quote` is always sent with `dry: true` unless the deployment sets `CONFIRM_LIVE_INTENTS=yes`
**and** the UI explicitly asks for a live quote. Why it is separate:

- there is no Intents testnet, so the escrow demo is testnet and this is mainnet-only;
- a three-way split is not one atomic intent: the contract settles the split, then each share can be
  routed onward with its own quote;
- fees depend on authentication — HACKATHON.md says 0.2%, 1Click docs say an extra 0.25% without a JWT.
  The UI reports which case applies instead of hard-coding a number.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next dev server on port 3000. |
| `npm run build` | Production build of the web app. |
| `npm run seed -- --write-env` | Token registrations, buyer funding, offer + creator code, env keys. |
| `npm run smoke` | On-chain assertions: split math, sale record, unknown-code refund, hold gating, release payouts, double-release refusal, optional gasless claim. |
| `npm run relay-client -- <offerId> <code>` | Sign a delegate as the creator and let `/api/relay` sponsor it. |
| `scripts/deploy-testnet.sh` | Build + deploy both contracts, initialise, whitelist the token. |

---

## Project layout

```text
contracts/referrail/      escrow + split contract, unit tests
contracts/test-ft/        demo NEP-141 token
apps/web/app/             routes: /, /business, /offer/[id], /creator, /intents, /ledger, /api/*
apps/web/components/      wallet provider, consoles, pay panel, Intents panel
apps/web/lib/             config, NEAR bindings, relayer/meta-tx, agent, Intents, formatting
scripts/                  deploy, seed, smoke, relay client
docs/demo-script.md       video/X script
DISCLOSURE.md             prior-work disclosure (Q-002)
```

---

## Status: what was verified, and what needs your machine

Verified in the environment this repository was assembled in:

- `cd contracts/referrail && cargo test` — all 20 tests pass.
- `cd contracts/test-ft && cargo test` — all 4 tests pass.
- `npm run typecheck` and `npm run build` — clean production build (all 23 routes compile).

Not verified here, because the sandbox had no `wasm32` standard library and no funded testnet accounts:

- `cargo near build non-reproducible-wasm` and the wasm artifacts,
- `scripts/deploy-testnet.sh` against a live testnet,
- `npm run seed` / `npm run smoke` against deployed contracts,
- a live 1Click quote (needs outbound access to `1click.chaindefuser.com`; the code path is a thin
  proxy over the documented endpoints).

Run those five steps before recording the demo; they are the same commands in the README above.
Because host tests compile with near-sdk's `unit-testing` feature, a host-only pass does not prove the
wasm build — `cargo near build` is the gate.

---

## Security notes

- No private key is shipped to the browser. Wallet writes are signed by NEAR Connect; server writes
  use the relayer's key or seeded throwaway demo keys.
- The relayer validates the decoded delegate before sponsoring it (method, receiver, deposit, gas).
- Demo signing routes are off unless `DEMO_MODE=yes`, are rate limited, and the faucet refuses any
  network other than testnet.
- `release` pays exactly the amounts snapshotted at purchase time, and a second release panics.
- Known limitation of the MVP: if a payout recipient is not registered on the token, that
  `ft_transfer` fails and the funds stay in the contract. `npm run seed` registers every recipient;
  production should add NEP-145 registration and a retry path.

## Prior work

See `DISCLOSURE.md`. ReferRail was prototyped on Celo and ShopRail on PayPal+Shopify before this
event. None of that code is in this repository; only this NEAR implementation is submitted to NEAR
HACKATHON.

## License

MIT — see `LICENSE`. Organisers may use the project name, screenshots and video for promotion.
