# Disclosure — prior work and what is new here

This repository is the NEAR HACKATHON submission. It is a **new repository** created for this
event, and every NEAR-specific module in it was written during the hackathon window
(1–14 November 2026).

## What was built on NEAR in this hackathon

| Module | Path | Notes |
|---|---|---|
| Escrow + split contract | `contracts/referrail` | Rust / `near-sdk` 5.30. NEP-141 `ft_on_transfer` receiver, refunds, permissionless `release`, per-creator codes, allow-lists, economics snapshotted per sale. |
| Demo NEP-141 token | `contracts/test-ft` | So the demo never depends on a third-party "fake USDT" account. Testnet only. |
| Next.js app | `apps/web` | Offers, business console, buyer flow, creator claim, public ledger, `/api/health`. |
| NEAR Connect login | `apps/web/components/wallet.tsx` | `@hot-labs/near-connect`; all writes are wallet-signed or demo-signed. |
| NEP-366 meta-tx relayer | `apps/web/app/api/relay/route.ts`, `apps/web/lib/near/signer.ts` | Sponsors **only** `register_creator` on this contract, zero attached deposit, ≤30 Tgas. |
| Agent (offer drafting + creator matching) | `apps/web/lib/agent`, `apps/web/app/api/agent/*` | NEAR AI Cloud (OpenAI-compatible) with a deterministic fallback; no wallet keys, no fund movement. |
| NEAR Intents (1Click) client | `apps/web/lib/intents.ts`, `apps/web/app/api/intents/*`, `/intents` page | Live `/v0/tokens`, `POST /v0/quote` with `dry: true` by default, status proxy. Mainnet-only module. |
| Testnet tooling | `scripts/deploy-testnet.sh`, `scripts/seed-demo.ts`, `scripts/smoke.ts`, `scripts/relay-client.ts` | Deploy, seed personas, assert the split end-to-end on chain, exercise the relayer from the CLI. |

## Prior work on other chains (not submitted here, not judged here)

The product idea — businesses publish commission rules, creators get links, the buyer pays, and
the sale is split — existed before this event in other hackathon work:

- **Celo ReferRail** (Celo Agents on Open Rails): an EVM escrow/attribution prototype.
- **PayPal ShopRail**: a storefront with PayPal Orders and payouts.

Neither is vendored, copied, or wrapped in this repository. No Solidity, EVM split logic, PayPal
SDK, x402, ERC-8004 or Celo attribution code appears here. The only thing carried over is the
product concept and general UX lessons; the NEAR contract, the test token, the relayer, the
Intents client and the app were written against NEAR primitives (`AccountId`, `U128`, NEP-141,
NEP-366, 1Click asset ids).

This is **not** the same project submitted twice to this hackathon. Only this repository is
submitted to NEAR HACKATHON.

## Third-party code and services

| Dependency | Use |
|---|---|
| `near-sdk` 5.30 (Rust) | Contract SDK. |
| `near-api-js` 7.4 | Server-side signing, RPC views, meta transactions. |
| `@hot-labs/near-connect` 0.12 | Wallet login and transaction signing in the browser. |
| `borsh` 2 | SignedDelegate serialisation on the relay path. |
| `next` 16 / `react` 19 | App framework. |
| NEAR AI Cloud (optional) | Offer-drafting inference; deterministic fallback ships. |
| 1Click / NEAR Intents (optional, mainnet) | Cross-chain quotes. |

No pre-hackathon proprietary library of ours is used. Templates were not vendored; the UI is
hand-written CSS.
