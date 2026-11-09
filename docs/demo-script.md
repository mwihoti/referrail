# Demo video script (~110 seconds)

Record from a clean local run that follows the README, so the recording *is* the reproducibility
proof. Have `npm run dev` running, the ledger open in a second tab, and the terminal visible for
the test output.

| Time | Shot | What to say |
|---|---|---|
| 0:00–0:10 | Landing page | "Businesses won't pay creators up front; creators won't invoice for a sale that might not happen. ReferRail fixes both with one link." |
| 0:10–0:30 | `/business`, type the sentence, click **Draft with agent**, edit nothing, click **Publish** | "I sell a $20 class and pay creators 15%. The agent drafts the rules — price, commission, refund hold — and I publish from my wallet. Nothing is paid yet." Open the receipt link. |
| 0:30–0:45 | `/creator`, pick the offer, code `ada`, click **Claim gaslessly** | "The creator claims a link and pays no gas: this is a NEP-366 meta transaction. The relayer sponsors only `register_creator`, and the contract still credits the creator, not the relayer." Copy the link. |
| 0:45–1:05 | Open the creator link, click **Pay as demo buyer** | "The buyer pays the demo USDC into escrow. Watch the split preview match: 15% creator, 2% protocol, the rest merchant." Click **Release the split now**, then open the three receipt links. |
| 1:05–1:25 | `/ledger` | "One contract call paid all three parties. The ledger reads straight from the contract views, and the merchant could have refunded until the hold expired." |
| 1:25–1:45 | `/intents`, choose ETH USDC → NEAR USDT (live list), click **Get quote** | "Intents has no testnet, so this is a dry mainnet quote: prices validated, no deposit address, nothing spent. After release, each party's share can be routed to the chain they already use, through the same 1Click API." |
| 1:45–2:00 | Terminal: `cd contracts/referrail && cargo test` | "The split math, refunds, hold and paused-offer rules are all asserted on the contract." End on the repo URL. |

## X post draft (the human posts this)

> Creators shouldn't invoice to get paid, and businesses shouldn't pay commission before a sale.
>
> I built ReferRail at NEAR HACKATHON: a referral link that splits each payment on NEAR — merchant,
> creator, protocol — and uses NEAR Intents so each side can receive on the chain they already use.
>
> Demo in the video. Code: <repo url>
>
> What's the first offer you would publish?
>
> @NEARProtocol #NEARHackathon

Attach the video (preferred). Never claim a Celo payout through Intents: `celo` is not on the
1Click token list as of 6 November 2026.

## Shots to avoid

- No architecture slides; the contract call and the split are the story.
- Do not show a live mainnet swap unless you deliberately funded one, and label it if you do.
- Do not hide the demo buyer's identity: the README and the UI both name the seeded personas.
