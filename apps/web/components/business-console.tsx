"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { WalletBar, useWallet } from "@/components/wallet";
import { TxLink } from "@/components/explorer";
import { friendlyReason } from "@/components/friendly-error";
import { bpsToPercent, formatDate, formatUnits, toSmallestUnits } from "@/lib/format";
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

/** Service fee assumed by the form checks when the live value can't be read. Matches the contract's cap. */
const FALLBACK_FEE_BPS = 200;

const EXAMPLE_PROMPTS = [
  "I sell a $20 online yoga class, creators get 15%, refunds allowed for 48 hours",
  "I sell a $35 photography preset pack, creators get 20%, refunds allowed for 24 hours",
  "I sell a $12 monthly newsletter, creators get 30%, no refund window",
];

/** Validation problems the person can fix in the form. Shown as-is, without an error prefix. */
class FormError extends Error {}

function plural(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

function durationText(seconds: number): string {
  if (seconds <= 0) return "No refund window";
  if (seconds % 86_400 === 0) return plural(seconds / 86_400, "day");
  if (seconds % 3_600 === 0) return plural(seconds / 3_600, "hour");
  if (seconds % 60 === 0) return plural(seconds / 60, "minute");
  return plural(seconds, "second");
}

function holdHoursText(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "No refund window";
  const seconds = Math.round(hours * 3_600);
  if (hours >= 24 && hours % 24 === 0) return `${plural(hours, "hour")} (${plural(hours / 24, "day")})`;
  if (Number.isInteger(hours)) return plural(hours, "hour");
  return durationText(seconds);
}

function holdNsText(ns: number): string {
  return durationText(Math.round(ns / 1_000_000_000));
}

function trimAmount(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function reasonOf(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : "";
  return friendlyReason(message, fallback);
}

function saleBadge(sale: Sale, releasable: boolean): { label: string; className: string } {
  if (sale.status === "Released") return { label: "Paid out", className: "badge-ok" };
  if (sale.status === "Refunded") return { label: "Refunded", className: "badge-danger" };
  if (releasable) return { label: "Ready to release", className: "badge-info" };
  return { label: "In refund window", className: "badge-warn" };
}

export function BusinessConsole({
  offers,
  salesByOffer,
  decimals,
  symbol,
  contractId,
  demoMode,
  demoAccounts,
  protocolFeeBps = null,
}: {
  offers: Offer[];
  salesByOffer: Record<number, Sale[]>;
  decimals: number;
  symbol: string;
  contractId: string;
  demoMode: boolean;
  demoAccounts: { merchant: string | null; creator: string | null; buyer: string | null };
  /** Live service fee from the contract, or null when it couldn't be read. */
  protocolFeeBps?: number | null;
}) {
  const router = useRouter();
  const { accountId, network, call } = useWallet();
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [draftSource, setDraftSource] = useState<{ source: string; note: string } | null>(null);
  const [assumptions, setAssumptions] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<string | undefined>();
  const [feedbackScope, setFeedbackScope] = useState<"compose" | "offers">("compose");

  const accountSuffix = network === "mainnet" ? "near" : "testnet";
  const exampleAccount = `your-shop.${accountSuffix}`;
  const hasDraft = Boolean(draft.title || draft.description);

  async function requestDraft() {
    setFeedbackScope("compose");
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
      setDraftSource({ source: payload.source ?? "unknown", note: payload.note ?? "" });
      setAssumptions(payload.draft.assumptions ?? []);
    } catch (err) {
      setError(`Couldn't suggest terms: ${reasonOf(err, "something went wrong")}`);
    } finally {
      setBusy(null);
    }
  }

  function buildArgs() {
    const price = Number(draft.price);
    const commissionBps = Math.round(Number(draft.commissionPercent) * 100);
    if (!draft.title.trim()) throw new FormError("Add a title for your offer before publishing.");
    if (!Number.isFinite(price) || price <= 0) throw new FormError("Enter a price above zero.");
    if (!Number.isFinite(commissionBps) || commissionBps < 0 || commissionBps >= 9_800) {
      throw new FormError("Set a creator commission below 98%.");
    }
    if (commissionBps + 200 >= 10_000) {
      throw new FormError("The creator commission plus the service fee must stay below 100%.");
    }
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
    setFeedbackScope("compose");
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
        setNotice("Your offer is live. Creators can now claim a referral link for it.");
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
        setNotice("Your offer is live. It was published with the sandbox account.");
      } else {
        throw new FormError("Connect a wallet to publish this offer.");
      }
      router.refresh();
    } catch (err) {
      setError(
        err instanceof FormError ? err.message : `Couldn't publish the offer: ${reasonOf(err, "something went wrong")}`,
      );
    } finally {
      setBusy(null);
    }
  }

  async function pauseOffer(offer: Offer) {
    setFeedbackScope("offers");
    setBusy(`pause-${offer.id}`);
    setError(null);
    try {
      await call({
        methodName: "pause_offer",
        args: { offer_id: offer.id, paused: !offer.paused },
        gasTgas: 30,
      });
      setNotice(
        offer.paused
          ? `"${offer.title}" is live again. New buyers can check out.`
          : `"${offer.title}" is paused. New buyers can't check out until you resume it.`,
      );
      router.refresh();
    } catch (err) {
      setError(
        `Couldn't ${offer.paused ? "resume" : "pause"} the offer: ${reasonOf(err, "something went wrong")}`,
      );
    } finally {
      setBusy(null);
    }
  }

  async function refund(sale: Sale) {
    setFeedbackScope("offers");
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
        throw new FormError("Connect the wallet that owns this offer to issue refunds.");
      }
      setNotice(`Sale #${sale.id} was refunded in full to ${sale.buyer}.`);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof FormError ? err.message : `Couldn't refund the sale: ${reasonOf(err, "something went wrong")}`,
      );
    } finally {
      setBusy(null);
    }
  }

  async function release(sale: Sale) {
    setFeedbackScope("offers");
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
      setNotice(`Sale #${sale.id} is paid out. The payment was split between you, the creator and the service fee.`);
      router.refresh();
    } catch (err) {
      setError(`Couldn't release the payout: ${reasonOf(err, "something went wrong")}`);
    } finally {
      setBusy(null);
    }
  }

  // ---- Review step: live split preview -------------------------------------------------
  const feeBps = protocolFeeBps ?? FALLBACK_FEE_BPS;
  const previewPrice = Number(draft.price);
  const previewCommissionBps = Math.round(Number(draft.commissionPercent) * 100);
  const previewValid =
    Number.isFinite(previewPrice) &&
    previewPrice > 0 &&
    Number.isFinite(previewCommissionBps) &&
    previewCommissionBps >= 0 &&
    previewCommissionBps + feeBps < 10_000;
  const merchantBps = 10_000 - previewCommissionBps - feeBps;
  const preview = previewValid
    ? {
        merchant: (previewPrice * merchantBps) / 10_000,
        creator: (previewPrice * previewCommissionBps) / 10_000,
        fee: (previewPrice * feeBps) / 10_000,
      }
    : null;
  const feeLabel = protocolFeeBps === null ? "up to 2%" : bpsToPercent(protocolFeeBps);
  const payoutTo =
    draft.payoutAccount.trim() || accountId || (demoMode ? "The sandbox account" : "The wallet you publish with");

  // ---- Dashboard totals -----------------------------------------------------------------
  const allSales = offers.flatMap((offer) => salesByOffer[offer.id] ?? []);
  const liveOffers = offers.filter((offer) => !offer.paused).length;
  const volume = allSales
    .filter((sale) => sale.status !== "Refunded")
    .reduce((sum, sale) => sum + BigInt(sale.amount), 0n);
  const awaitingRelease = allSales.filter((sale) => sale.status === "Pending").length;

  const feedback = (
    <>
      {error ? (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="notice notice-success" role="status">
          <span>{notice}</span>{" "}
          {lastHash ? <TxLink network={network} hash={lastHash} label="View transaction" /> : null}
        </div>
      ) : null}
    </>
  );

  return (
    <div className="stack-lg">
      <WalletBar demoAccounts={demoMode ? demoAccounts : undefined} />

      {!contractId ? (
        <div className="notice notice-warn" role="status">
          <p className="notice-title">Offers are temporarily unavailable</p>
          <p className="mb-0">
            We can't reach the offer service right now, so offers and sales can't be loaded or published. Please try
            again in a few minutes.
          </p>
        </div>
      ) : null}

      {/* Step 1 and 2: describe, review, publish */}
      <section className="stack" aria-labelledby="describe-title" id="describe">
        <div className="card">
          <div className="card-head">
            <div>
              <p className="eyebrow">Step 1</p>
              <h2 id="describe-title">Describe your offer</h2>
              <p className="muted small mt-2 mb-0">
                Write one sentence. The assistant turns it into offer terms you can review and edit.
              </p>
            </div>
            {accountId ? (
              <span className="badge badge-ok badge-dot">Wallet connected</span>
            ) : demoMode ? (
              <span className="badge badge-info badge-dot">Sandbox account available</span>
            ) : (
              <span className="badge badge-warn badge-dot">Connect a wallet to publish</span>
            )}
          </div>

          <div className="stack">
            <div className="field">
              <label htmlFor="offer-prompt">What are you selling?</label>
              <textarea
                id="offer-prompt"
                rows={3}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={`I sell a $20 online course, creators get 15%, refunds allowed for 48 hours, pay me at ${exampleAccount}`}
                aria-describedby="offer-prompt-hint"
              />
              <p className="field-hint" id="offer-prompt-hint">
                Mention the price, the creator commission and how long buyers can ask for a refund. Add a payout
                account if it differs from the one you publish with.
                {network === "testnet" ? ` Prices are set in ${symbol}, a test token. No real money is charged.` : ""}
              </p>
            </div>

            <div className="stack-sm">
              <span className="xsmall muted" id="examples-label">
                Or start from an example
              </span>
              <div className="tabs" role="group" aria-labelledby="examples-label">
                {EXAMPLE_PROMPTS.map((example) => (
                  <button
                    key={example}
                    type="button"
                    className="pill"
                    aria-pressed={prompt === example}
                    onClick={() => setPrompt(example)}
                  >
                    {example.replace(/^I sell an? /, "").split(",")[0]}
                  </button>
                ))}
              </div>
            </div>

            <div className="row">
              <button
                type="button"
                className="btn"
                onClick={requestDraft}
                disabled={busy !== null || prompt.trim().length < 3}
              >
                {busy === "draft" ? "Suggesting terms…" : hasDraft ? "Suggest again" : "Suggest terms"}
              </button>
              {draftSource ? (
                <span className="muted small">
                  {draftSource.source === "llm"
                    ? "Terms suggested by the assistant. Review them before publishing."
                    : draftSource.source === "rules"
                      ? "Terms filled in from your sentence. Review them before publishing."
                      : "Terms suggested. Review them before publishing."}
                </span>
              ) : null}
            </div>

            {assumptions.length > 0 ? (
              <div className="notice notice-info">
                <p className="notice-title">A few things the assistant assumed</p>
                <ul className="mb-0">
                  {assumptions.map((assumption) => (
                    <li key={assumption}>{assumption}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {draftSource?.note ? (
              <details className="details">
                <summary>Technical details</summary>
                <div className="details-body">
                  <p className="small muted mb-0">
                    {draftSource.source === "llm"
                      ? `These terms were drafted by a language model. ${draftSource.note}`
                      : draftSource.source === "rules"
                        ? "These terms were filled in by a rules-based parser that reads the price, commission, refund window and payout account straight from your sentence. The language model assistant wasn't available for this request."
                        : draftSource.note}
                  </p>
                </div>
              </details>
            ) : null}

            {!hasDraft && feedbackScope === "compose" ? feedback : null}
          </div>
        </div>

        {hasDraft ? (
          <section className="card card-accent" aria-labelledby="review-title">
            <div className="card-head">
              <div>
                <p className="eyebrow">Step 2</p>
                <h2 id="review-title">Review and publish</h2>
                <p className="muted small mt-2 mb-0">
                  Check the terms below and edit anything you like. Nothing is published until you confirm.
                </p>
              </div>
            </div>

            <div className="stack">
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="title">Offer title</label>
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
                    aria-describedby="commission-hint"
                  />
                  <p className="field-hint" id="commission-hint">
                    Paid to the creator on each completed sale.
                  </p>
                </div>
                <div className="field">
                  <label htmlFor="hold">Refund window (hours)</label>
                  <input
                    id="hold"
                    inputMode="numeric"
                    value={draft.holdHours}
                    onChange={(e) => setDraft({ ...draft, holdHours: e.target.value })}
                    aria-describedby="hold-hint"
                  />
                  <p className="field-hint" id="hold-hint">
                    {holdHoursText(Number(draft.holdHours) || 0)}. Payouts are released after it closes.
                  </p>
                </div>
                <div className="field">
                  <label htmlFor="payout">Payout account</label>
                  <input
                    id="payout"
                    placeholder={exampleAccount}
                    value={draft.payoutAccount}
                    onChange={(e) => setDraft({ ...draft, payoutAccount: e.target.value })}
                    aria-describedby="payout-hint"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <p className="field-hint" id="payout-hint">
                    Leave empty to be paid to the account you publish with.
                  </p>
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

              <div className="grid grid-2">
                <div className="card card-flat card-tight">
                  <h3 className="mt-0">Summary</h3>
                  <dl className="kv">
                    <dt>Price</dt>
                    <dd className="num">
                      {draft.price || "—"} {symbol}
                    </dd>
                    <dt>Creator commission</dt>
                    <dd className="num">{draft.commissionPercent ? `${draft.commissionPercent}%` : "—"}</dd>
                    <dt>Service fee</dt>
                    <dd className="num">{feeLabel} per completed sale</dd>
                    <dt>Refund window</dt>
                    <dd>{holdHoursText(Number(draft.holdHours) || 0)}</dd>
                    <dt>Payout to</dt>
                    <dd className={draft.payoutAccount.trim() || accountId ? "mono" : undefined}>
                      {payoutTo}
                    </dd>
                  </dl>
                </div>

                <div className="card card-flat card-tight">
                  <h3 className="mt-0">How each sale is split</h3>
                  {preview ? (
                    <>
                      <div
                        className="splitbar mt-3"
                        role="img"
                        aria-label={`You ${bpsToPercent(merchantBps)}, creator ${bpsToPercent(previewCommissionBps)}, service fee ${bpsToPercent(feeBps)}`}
                      >
                        <span className="splitbar-seg seg-merchant" style={{ width: `${merchantBps / 100}%` }} />
                        <span
                          className="splitbar-seg seg-creator"
                          style={{ width: `${previewCommissionBps / 100}%` }}
                        />
                        <span className="splitbar-seg seg-protocol" style={{ width: `${feeBps / 100}%` }} />
                      </div>
                      <ul className="legend">
                        <li>
                          <span className="legend-swatch seg-merchant" aria-hidden="true" />
                          You {bpsToPercent(merchantBps)}{" "}
                          <strong>
                            {trimAmount(preview.merchant)} {symbol}
                          </strong>
                        </li>
                        <li>
                          <span className="legend-swatch seg-creator" aria-hidden="true" />
                          Creator {bpsToPercent(previewCommissionBps)}{" "}
                          <strong>
                            {trimAmount(preview.creator)} {symbol}
                          </strong>
                        </li>
                        <li>
                          <span className="legend-swatch seg-protocol" aria-hidden="true" />
                          Service fee {bpsToPercent(feeBps)}{" "}
                          <strong>
                            {trimAmount(preview.fee)} {symbol}
                          </strong>
                        </li>
                      </ul>
                      <p className="hint mt-3">
                        Estimate for one sale at full price.
                        {protocolFeeBps === null ? " Uses the maximum 2% service fee." : ""} Refunded sales cost you
                        nothing.
                      </p>
                    </>
                  ) : (
                    <p className="muted small">
                      Enter a price above zero and a commission that leaves room for the service fee to see the split.
                    </p>
                  )}
                </div>
              </div>

              <div className="card-foot stack-sm mt-0">
                <div className="row">
                  <button type="button" className="btn btn-lg" onClick={publish} disabled={busy !== null}>
                    {busy === "publish"
                      ? "Publishing…"
                      : accountId
                        ? "Publish offer"
                        : demoMode
                          ? "Publish with sandbox account"
                          : "Publish offer"}
                  </button>
                  <span className="muted small">
                    {accountId
                      ? "Your wallet will ask you to confirm before anything is published."
                      : demoMode
                        ? null
                        : "Connect a wallet to publish."}
                  </span>
                </div>
                {!accountId && demoMode ? (
                  <p className="sandbox-note">Uses a shared sandbox account on the test network.</p>
                ) : null}
              </div>

              {feedbackScope === "compose" ? feedback : null}
            </div>
          </section>
        ) : null}
      </section>

      {/* Offers and sales */}
      <section className="stack" aria-labelledby="offers-title">
        <div className="section-head">
          <div>
            <h2 className="section-title" id="offers-title">
              All offers on ReferRail
            </h2>
            <p className="section-lead">
              Offers and sales from every business. Offers you own are marked &quot;Your offer&quot;; you can pause
              them and refund their sales. Payments stay in escrow until the refund window closes, then the payout
              can be released.
            </p>
          </div>
          <span className="badge">{offers.length === 1 ? "1 offer" : `${offers.length} offers`}</span>
        </div>

        {offers.length > 0 ? (
          <div className="stats">
            <div className="stat">
              <span className="stat-label">Live offers</span>
              <span className="stat-value">{liveOffers}</span>
              <span className="stat-hint">of {offers.length} listed</span>
            </div>
            <div className="stat">
              <span className="stat-label">Sales</span>
              <span className="stat-value">{allSales.length}</span>
              <span className="stat-hint">Including refunds</span>
            </div>
            <div className="stat">
              <span className="stat-label">Sales volume</span>
              <span className="stat-value">
                {formatUnits(volume, decimals)}
                <span className="stat-unit">{symbol}</span>
              </span>
              <span className="stat-hint">Excluding refunds</span>
            </div>
            <div className="stat">
              <span className="stat-label">Awaiting release</span>
              <span className="stat-value">{awaitingRelease}</span>
              <span className="stat-hint">Sales held in escrow</span>
            </div>
          </div>
        ) : null}

        {feedbackScope === "offers" ? feedback : null}

        {offers.length === 0 ? (
          <div className="empty">
            <h3 className="empty-title">No offers yet</h3>
            <p>Describe your first offer above. It takes about a minute, and creators can start sharing right away.</p>
            <div className="row">
              <a className="btn btn-sm" href="#offer-prompt">
                Describe your offer
              </a>
            </div>
          </div>
        ) : (
          offers.map((offer) => {
            const sales = salesByOffer[offer.id] ?? [];
            const isOwner = accountId === offer.merchant;
            return (
              <article className="card stack" key={offer.id} aria-labelledby={`offer-${offer.id}-title`}>
                <div className="row-between row-top">
                  <div className="stack-sm grow">
                    <div className="row">
                      {offer.paused ? (
                        <span className="badge badge-warn badge-dot">Paused</span>
                      ) : (
                        <span className="badge badge-ok badge-dot">Live</span>
                      )}
                      {isOwner ? <span className="badge badge-info">Your offer</span> : null}
                      <span className="faint xsmall">Offer #{offer.id}</span>
                    </div>
                    <h3 className="mt-0 mb-0" id={`offer-${offer.id}-title`}>
                      {offer.title}
                    </h3>
                  </div>
                  <div className="row">
                    <Link className="btn btn-ghost btn-sm" href={`/offer/${offer.id}`}>
                      View offer page
                    </Link>
                    {isOwner ? (
                      <button
                        type="button"
                        className="btn btn-subtle btn-sm"
                        onClick={() => pauseOffer(offer)}
                        disabled={busy !== null}
                      >
                        {busy === `pause-${offer.id}`
                          ? offer.paused
                            ? "Resuming…"
                            : "Pausing…"
                          : offer.paused
                            ? "Resume"
                            : "Pause"}
                      </button>
                    ) : null}
                  </div>
                </div>

                <dl className="kv">
                  <dt>Price</dt>
                  <dd className="num">
                    {formatUnits(offer.price, decimals)} {symbol}
                  </dd>
                  <dt>Creator commission</dt>
                  <dd className="num">{bpsToPercent(offer.commission_bps)}</dd>
                  <dt>Service fee</dt>
                  <dd className="num">{bpsToPercent(offer.protocol_fee_bps)}</dd>
                  <dt>Refund window</dt>
                  <dd>{holdNsText(offer.refund_hold_ns)}</dd>
                  <dt>Business account</dt>
                  <dd className="mono">{offer.merchant}</dd>
                </dl>

                {sales.length === 0 ? (
                  <div className="empty">
                    <h4 className="empty-title">No sales yet</h4>
                    <p>
                      Invite creators to share this offer. Each one gets a personal referral link, and you only pay
                      commission when a sale completes.
                    </p>
                    <div className="row">
                      <Link className="btn btn-ghost btn-sm" href={`/offer/${offer.id}`}>
                        View offer page
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <caption className="sr-only">Sales for {offer.title}</caption>
                      <thead>
                        <tr>
                          <th scope="col">Sale</th>
                          <th scope="col">Buyer</th>
                          <th scope="col">Referred by</th>
                          <th scope="col">Split</th>
                          <th scope="col">Status</th>
                          <th scope="col">
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {sales.map((sale) => {
                          const releasable =
                            sale.status === "Pending" && Date.now() * 1_000_000 >= Number(sale.release_at_ns);
                          const badge = saleBadge(sale, releasable);
                          const holdOver = Date.now() * 1_000_000 >= Number(sale.release_at_ns);
                          return (
                            <tr key={sale.id}>
                              <td className="mono">#{sale.id}</td>
                              <td className="mono small">{sale.buyer}</td>
                              <td className="small">
                                {sale.creator ? <span className="mono">{sale.creator}</span> : <span className="muted">No creator</span>}
                                {sale.creator_code ? (
                                  <div className="muted xsmall">
                                    Code <span className="mono">{sale.creator_code}</span>
                                  </div>
                                ) : null}
                              </td>
                              <td className="small num">
                                <div>
                                  You {formatUnits(sale.merchant_amount, decimals)} {symbol}
                                </div>
                                <div className="muted">Creator {formatUnits(sale.creator_amount, decimals)}</div>
                                <div className="muted">Fee {formatUnits(sale.protocol_amount, decimals)}</div>
                              </td>
                              <td>
                                <span className={`badge ${badge.className}`}>{badge.label}</span>
                                <div className="muted xsmall mt-2">
                                  {holdOver ? "Window closed" : "Window closes"} {formatDate(sale.release_at_ns)}
                                </div>
                              </td>
                              <td>
                                <div className="row">
                                  {sale.status === "Pending" ? (
                                    <>
                                      <button
                                        type="button"
                                        className="btn btn-sm"
                                        onClick={() => release(sale)}
                                        disabled={!releasable || busy !== null}
                                        title={
                                          releasable
                                            ? "Pay out this sale now"
                                            : "Available once the refund window closes"
                                        }
                                      >
                                        {busy === `release-${sale.id}` ? "Releasing…" : "Release payout"}
                                      </button>
                                      <button
                                        type="button"
                                        className="btn btn-danger btn-sm"
                                        onClick={() => refund(sale)}
                                        disabled={busy !== null}
                                      >
                                        {busy === `refund-${sale.id}` ? "Refunding…" : "Refund"}
                                      </button>
                                    </>
                                  ) : (
                                    <span className="muted small">Settled</span>
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
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}
