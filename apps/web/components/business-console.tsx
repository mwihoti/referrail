"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { WalletBar, useWallet } from "@/components/wallet";
import { TxLink } from "@/components/explorer";
import { bpsToPercent, formatDate, formatUnits, holdLabel, toSmallestUnits } from "@/lib/format";
import type { Offer, Sale } from "@/lib/types";

interface DraftState {
  title: string;
  description: string;
  price: string;
  commissionPercent: string;
  holdHours: string;
  payoutAccount: string;
}

const EMPTY_DRAFT: DraftState = {
  title: "",
  description: "",
  price: "10",
  commissionPercent: "15",
  holdHours: "0",
  payoutAccount: "",
};

export function BusinessConsole({
  offers,
  salesByOffer,
  decimals,
  symbol,
  contractId,
  demoMode,
  demoAccounts,
}: {
  offers: Offer[];
  salesByOffer: Record<number, Sale[]>;
  decimals: number;
  symbol: string;
  contractId: string;
  demoMode: boolean;
  demoAccounts: { merchant: string | null; creator: string | null; buyer: string | null };
}) {
  const router = useRouter();
  const { accountId, network, call } = useWallet();
  const [prompt, setPrompt] = useState(
    "I sell a $20 yoga class, creators get 15%, refund hold 0 hours, pay me rr-biz.testnet",
  );
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [source, setSource] = useState<string>("");
  const [assumptions, setAssumptions] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<string | undefined>();

  const merchant = demoMode ? demoAccounts.merchant : null;

  async function requestDraft() {
    setBusy("draft");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/agent/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const payload = (await response.json()) as {
        error?: string;
        source?: string;
        note?: string;
        draft?: {
          title: string;
          description: string;
          price: number;
          commission_bps: number;
          refund_hold_hours: number;
          payout_account: string;
          assumptions: string[];
        };
      };
      if (!response.ok || !payload.draft) throw new Error(payload.error ?? "Draft failed");
      setDraft({
        title: payload.draft.title,
        description: payload.draft.description,
        price: String(payload.draft.price),
        commissionPercent: String(payload.draft.commission_bps / 100),
        holdHours: String(payload.draft.refund_hold_hours),
        payoutAccount: payload.draft.payout_account,
      });
      setSource(`${payload.source ?? "unknown"} — ${payload.note ?? ""}`);
      setAssumptions(payload.draft.assumptions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Draft failed");
    } finally {
      setBusy(null);
    }
  }

  function buildArgs() {
    const price = Number(draft.price);
    const commissionBps = Math.round(Number(draft.commissionPercent) * 100);
    if (!draft.title.trim()) throw new Error("Title is required");
    if (!Number.isFinite(price) || price <= 0) throw new Error("Price must be positive");
    if (!Number.isFinite(commissionBps) || commissionBps < 0 || commissionBps >= 9_800) {
      throw new Error("Commission must be between 0% and 98%");
    }
    if (commissionBps + 200 >= 10_000) throw new Error("Commission + 2% protocol fee must be below 100%");
    return {
      title: draft.title.trim(),
      description: draft.description.trim(),
      token: undefined,
      price: toSmallestUnits(price, decimals),
      commission_bps: commissionBps,
      refund_hold_hours: Number(draft.holdHours) || 0,
      payout_account: draft.payoutAccount.trim() || null,
    };
  }

  async function publish() {
    setBusy("publish");
    setError(null);
    setNotice(null);
    try {
      const args = buildArgs();
      if (accountId) {
        const result = await call({
          methodName: "create_offer",
          args: {
            title: args.title,
            description: args.description,
            token: undefined,
            price: args.price,
            commission_bps: args.commission_bps,
            refund_hold_ns: Math.round(args.refund_hold_hours * 3_600_000_000_000),
            allowed_creators: null,
            payout_account: args.payout_account,
            intents_dest: null,
          },
          gasTgas: 60,
        });
        setLastHash(result.hash);
        setNotice("Offer published from your wallet.");
      } else if (demoMode) {
        const response = await fetch("/api/demo/create-offer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: args.title,
            description: args.description,
            price: Number(draft.price),
            commission_bps: args.commission_bps,
            refund_hold_hours: args.refund_hold_hours,
            payout_account: args.payout_account,
          }),
        });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Publish failed");
        setNotice(`Offer published by the demo merchant (${demoAccounts.merchant}).`);
      } else {
        throw new Error("Connect a wallet, or enable DEMO_MODE with seeded accounts.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setBusy(null);
    }
  }

  async function pauseOffer(offer: Offer) {
    setBusy(`pause-${offer.id}`);
    setError(null);
    try {
      await call({
        methodName: "pause_offer",
        args: { offer_id: offer.id, paused: !offer.paused },
        gasTgas: 30,
      });
      setNotice(`Offer #${offer.id} ${offer.paused ? "resumed" : "paused"}.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the offer state");
    } finally {
      setBusy(null);
    }
  }

  async function refund(sale: Sale) {
    setBusy(`refund-${sale.id}`);
    setError(null);
    try {
      if (accountId) {
        await call({ methodName: "refund", args: { sale_id: sale.id }, gasTgas: 100 });
      } else if (demoMode) {
        const response = await fetch("/api/demo/refund", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ saleId: sale.id }),
        });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Refund failed");
      } else {
        throw new Error("Connect the merchant wallet to refund");
      }
      setNotice(`Sale #${sale.id} refunded to ${sale.buyer}.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refund failed");
    } finally {
      setBusy(null);
    }
  }

  async function release(sale: Sale) {
    setBusy(`release-${sale.id}`);
    setError(null);
    try {
      const response = await fetch("/api/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saleId: sale.id }),
      });
      const payload = (await response.json()) as { error?: string; outcome?: { transaction?: { hash?: string } } };
      if (!response.ok) throw new Error(payload.error ?? "Release failed");
      setLastHash(payload.outcome?.transaction?.hash);
      setNotice(`Sale #${sale.id} released: merchant, creator and treasury were paid.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Release failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      <WalletBar demoAccounts={demoAccounts} />

      {!contractId ? (
        <div className="card warn-card">Set NEAR_CONTRACT_ID so this console can read and write the contract.</div>
      ) : null}

      <section className="card stack">
        <div className="row-between">
          <h2>Agent → offer draft</h2>
          <span className="badge">{demoMode ? "demo signing on" : accountId ? "wallet publishing" : "wallet required"}</span>
        </div>
        <textarea
          rows={3}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="I sell a $20 PDF guide, creators get 15%, refund hold 48 hours, pay me my-shop.testnet"
        />
        <div className="row">
          <button className="btn" onClick={requestDraft} disabled={busy !== null || prompt.trim().length < 3}>
            {busy === "draft" ? "Drafting…" : "Draft with agent"}
          </button>
          {source ? <span className="muted small">{source}</span> : null}
        </div>

        {assumptions.length > 0 ? (
          <div className="notice">
            Assumptions: {assumptions.join(" ")}
          </div>
        ) : null}

        {draft.title || draft.description ? (
          <div className="stack">
            <div className="form-grid">
              <div className="field">
                <label htmlFor="title">Title</label>
                <input id="title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="price">Price ({symbol})</label>
                <input
                  id="price"
                  inputMode="decimal"
                  value={draft.price}
                  onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="commission">Creator commission (%)</label>
                <input
                  id="commission"
                  inputMode="decimal"
                  value={draft.commissionPercent}
                  onChange={(e) => setDraft({ ...draft, commissionPercent: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="hold">Refund hold (hours)</label>
                <input
                  id="hold"
                  inputMode="numeric"
                  value={draft.holdHours}
                  onChange={(e) => setDraft({ ...draft, holdHours: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="payout">Merchant payout account</label>
                <input
                  id="payout"
                  placeholder="defaults to your wallet"
                  value={draft.payoutAccount}
                  onChange={(e) => setDraft({ ...draft, payoutAccount: e.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="description">Description</label>
              <textarea
                id="description"
                rows={2}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>
            <div className="row">
              <button className="btn" onClick={publish} disabled={busy !== null}>
                {busy === "publish" ? "Publishing…" : accountId ? "Publish with wallet" : demoMode ? "Publish as demo merchant" : "Publish"}
              </button>
              <span className="muted small">
                The wallet call is <code>create_offer</code>. Nothing is published until you click.
              </span>
            </div>
          </div>
        ) : null}

        {error ? <p className="error small">{error}</p> : null}
        {notice ? (
          <p className="notice">
            {notice} {lastHash ? <TxLink network={network} hash={lastHash} /> : null}
          </p>
        ) : null}
      </section>

      <section className="stack">
        <div className="section-head">
          <h2>Offers ({offers.length})</h2>
          <span className="muted small">release and refund stay inside the contract</span>
        </div>
        {offers.length === 0 ? (
          <div className="card muted">No offers yet.</div>
        ) : (
          offers.map((offer) => {
            const sales = salesByOffer[offer.id] ?? [];
            return (
              <div className="card stack" key={offer.id}>
                <div className="row-between">
                  <div>
                    <h3>
                      #{offer.id} · {offer.title}{" "}
                      {offer.paused ? <span className="badge badge-warn">paused</span> : <span className="badge badge-ok">live</span>}
                    </h3>
                    <p className="muted small">
                      {formatUnits(offer.price, decimals)} {symbol} · {bpsToPercent(offer.commission_bps)} creators ·{" "}
                      {bpsToPercent(offer.protocol_fee_bps)} protocol · hold {holdLabel(offer.refund_hold_ns)} · merchant{" "}
                      <span className="mono">{offer.merchant}</span>
                    </p>
                  </div>
                  <div className="row">
                    <a className="btn btn-ghost btn-sm" href={`/offer/${offer.id}`}>
                      Buyer view
                    </a>
                    {accountId === offer.merchant ? (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => pauseOffer(offer)}
                        disabled={busy !== null}
                      >
                        {busy === `pause-${offer.id}` ? "Working…" : offer.paused ? "Resume" : "Pause"}
                      </button>
                    ) : null}
                  </div>
                </div>

                {sales.length === 0 ? (
                  <p className="muted small">No sales yet. Share the buyer view link with a creator code.</p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Sale</th>
                          <th>Buyer</th>
                          <th>Creator</th>
                          <th>Split</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sales.map((sale) => {
                          const releasable =
                            sale.status === "Pending" && Date.now() * 1_000_000 >= Number(sale.release_at_ns);
                          return (
                            <tr key={sale.id}>
                              <td className="mono">#{sale.id}</td>
                              <td className="mono small">{sale.buyer}</td>
                              <td className="mono small">
                                {sale.creator ?? "—"}
                                {sale.creator_code ? <span className="muted"> · {sale.creator_code}</span> : null}
                              </td>
                              <td className="small">
                                {formatUnits(sale.merchant_amount, decimals)} /{" "}
                                {formatUnits(sale.creator_amount, decimals)} /{" "}
                                {formatUnits(sale.protocol_amount, decimals)}
                              </td>
                              <td>
                                <span
                                  className={`badge ${
                                    sale.status === "Released" ? "badge-ok" : sale.status === "Refunded" ? "badge-danger" : "badge-warn"
                                  }`}
                                >
                                  {sale.status}
                                </span>
                                <div className="muted small">until {formatDate(sale.release_at_ns)}</div>
                              </td>
                              <td>
                                <div className="row">
                                  {sale.status === "Pending" ? (
                                    <>
                                      <button
                                        className="btn btn-sm"
                                        onClick={() => release(sale)}
                                        disabled={!releasable || busy !== null}
                                        title={releasable ? "Split the escrow now" : "Refund hold has not elapsed"}
                                      >
                                        {busy === `release-${sale.id}` ? "…" : "Release"}
                                      </button>
                                      <button
                                        className="btn btn-danger btn-sm"
                                        onClick={() => refund(sale)}
                                        disabled={busy !== null}
                                      >
                                        {busy === `refund-${sale.id}` ? "…" : "Refund"}
                                      </button>
                                    </>
                                  ) : (
                                    <span className="muted small">settled</span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
