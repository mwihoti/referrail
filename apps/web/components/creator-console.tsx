"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { TxLink } from "@/components/explorer";
import { friendlyReason } from "@/components/friendly-error";
import { WalletBar, useWallet } from "@/components/wallet";
import { bpsToPercent, formatUnits } from "@/lib/format";
import type { Sale, SaleStatus } from "@/lib/types";

interface OfferSummary {
  id: number;
  title: string;
  commission_bps: number;
  paused: boolean;
}

const STATUS_LABEL: Record<SaleStatus, string> = {
  Pending: "In refund window",
  Released: "Paid out",
  Refunded: "Refunded",
};

/** Problems the person can fix in the form. Shown as plain sentences, without an error prefix. */
class FormError extends Error {}

const STATUS_CLASS: Record<SaleStatus, string> = {
  Pending: "badge-warn",
  Released: "badge-ok",
  Refunded: "badge-danger",
};

export function CreatorConsole({
  offers,
  contractId,
  decimals,
  symbol,
  demoMode,
  demoCreator,
  relayerConfigured,
}: {
  offers: OfferSummary[];
  contractId: string;
  decimals: number;
  symbol: string;
  demoMode: boolean;
  demoCreator: string | null;
  relayerConfigured: boolean;
}) {
  const { accountId, network, call } = useWallet();
  const [offerId, setOfferId] = useState(offers[0]?.id ? String(offers[0].id) : "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hash, setHash] = useState<string | undefined>();
  const [link, setLink] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">("idle");
  const [sales, setSales] = useState<Sale[]>([]);
  const [earnings, setEarnings] = useState("0");
  const [salesLoaded, setSalesLoaded] = useState(false);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const usingSandbox = !accountId && demoMode;
  const salesAccount = accountId || (demoMode ? demoCreator : null);

  const loadSales = useCallback(async () => {
    const target = accountId || (demoMode ? demoCreator : null);
    if (!target) return;
    try {
      const response = await fetch(`/api/creator?account=${encodeURIComponent(target)}`, { cache: "no-store" });
      if (response.ok) {
        const payload = (await response.json()) as { sales?: Sale[]; earnings?: string };
        setSales(payload.sales ?? []);
        setEarnings(payload.earnings ?? "0");
      }
    } catch {
      // Non-fatal: the table simply stays empty.
    } finally {
      setSalesLoaded(true);
    }
  }, [accountId, demoMode, demoCreator]);

  useEffect(() => {
    void loadSales();
  }, [loadSales]);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  function buildLink(id: number, referral: string) {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    return `${origin}/offer/${id}?ref=${encodeURIComponent(referral)}`;
  }

  async function claim() {
    setBusy("claim");
    setError(null);
    setNotice(null);
    try {
      const id = Number(offerId);
      if (!Number.isInteger(id) || id < 1) throw new FormError("Choose an offer to promote.");
      const referral = code.trim();
      if (!/^[a-z0-9_-]{1,32}$/i.test(referral)) {
        throw new FormError("Your code can use 1–32 letters, numbers, dashes or underscores.");
      }

      if (accountId) {
        const result = await call({
          methodName: "register_creator",
          args: { offer_id: id, code: referral, payout_account: null, commission_bps_override: null },
          gasTgas: 30,
        });
        setHash(result.hash);
        setNotice("Commissions from it are paid to your wallet.");
      } else if (demoMode) {
        const response = await fetch("/api/demo/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offerId: id, code: referral }),
        });
        const payload = (await response.json()) as { error?: string; mode?: string; account?: string; outcome?: { transaction?: { hash?: string } } };
        if (!response.ok) throw new Error(payload.error ?? "the request didn't go through");
        setHash(payload.outcome?.transaction?.hash);
        setNotice(
          payload.mode === "meta-tx"
            ? "The network fee for claiming it was covered for you. It's registered to the shared sandbox account."
            : "It's registered to the shared sandbox account.",
        );
      } else {
        throw new FormError("Connect a wallet to claim your link.");
      }

      setLink(buildLink(id, referral));
      setCopyState("idle");
      await loadSales();
    } catch (err) {
      if (err instanceof FormError) {
        setError(err.message);
      } else {
        const reason = friendlyReason(err instanceof Error ? err.message : "").replace(/[.\s]+$/, "");
        setError(`Couldn't claim the link: ${reason}.`);
      }
    } finally {
      setBusy(null);
    }
  }

  async function copyLink() {
    if (!link) return;
    if (copyTimer.current) clearTimeout(copyTimer.current);
    try {
      await navigator.clipboard.writeText(link);
      setCopyState("copied");
      copyTimer.current = setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      // Clipboard access can be blocked; select the text so it can be copied by hand.
      linkInputRef.current?.focus();
      linkInputRef.current?.select();
      setCopyState("manual");
    }
  }

  const claimLabel =
    busy === "claim"
      ? "Claiming…"
      : accountId
        ? "Claim link"
        : demoMode
          ? "Claim with sandbox account"
          : "Connect wallet to claim";

  const offerTitles = new Map(offers.map((offer) => [offer.id, offer.title]));
  const pendingCount = sales.filter((sale) => sale.status === "Pending").length;
  const paidCount = sales.filter((sale) => sale.status === "Released").length;

  return (
    <div className="stack-lg">
      <WalletBar demoAccounts={demoMode ? { merchant: null, creator: demoCreator, buyer: null } : undefined} />

      <section className="card stack" aria-labelledby="claim-title">
        <div className="card-head">
          <div>
            <h2 id="claim-title" className="section-title">
              Claim your referral link
            </h2>
            <p className="section-lead">Choose an offer and pick a short code. Your link is ready in seconds.</p>
          </div>
          {usingSandbox && relayerConfigured ? <span className="badge badge-ok">No network fee</span> : null}
        </div>

        {offers.length === 0 ? (
          <div className="empty">
            <h3 className="empty-title">No offers to promote yet</h3>
            <p>When businesses publish offers, they show up here for you to claim. Run a business? Publish the first one.</p>
            <div className="row">
              <Link className="btn btn-ghost" href="/business">
                Publish an offer
              </Link>
            </div>
          </div>
        ) : (
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              void claim();
            }}
          >
            <div className="form-grid">
              <div className="field">
                <label htmlFor="offer">Offer</label>
                <select id="offer" value={offerId} onChange={(event) => setOfferId(event.target.value)}>
                  {offers.map((offer) => (
                    <option key={offer.id} value={offer.id}>
                      {offer.title} · {bpsToPercent(offer.commission_bps)} commission
                      {offer.paused ? " (paused)" : ""}
                    </option>
                  ))}
                </select>
                <p className="field-hint">You earn this share of every sale made through your link.</p>
              </div>
              <div className="field">
                <label htmlFor="code">Your code</label>
                <input
                  id="code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="e.g. maya"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={32}
                  aria-describedby="code-hint"
                />
                <p id="code-hint" className="field-hint">
                  Letters, numbers, dashes or underscores. It appears at the end of your link.
                </p>
              </div>
            </div>

            <div className="stack-sm">
              <div className="row">
                <button type="submit" className="btn" disabled={busy !== null || !contractId || !offerId}>
                  {claimLabel}
                </button>
              </div>
              {usingSandbox ? (
                <p className="sandbox-note">Uses a shared sandbox account on the test network.</p>
              ) : accountId ? (
                <p className="field-hint">Your wallet will ask you to approve the claim and a small network fee.</p>
              ) : null}
            </div>
          </form>
        )}

        {error ? (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {link ? (
        <section className="card card-accent stack" aria-labelledby="link-title">
          <div role="status">
            <h2 id="link-title" className="section-title">
              Your link is ready
            </h2>
            <p className="section-lead">
              Share it with your audience. Every sale made through it is credited to you.{notice ? ` ${notice}` : ""}
            </p>
          </div>
          <div className="input-row">
            <label htmlFor="share-link" className="sr-only">
              Your referral link
            </label>
            <input id="share-link" ref={linkInputRef} readOnly value={link} className="mono" onFocus={(event) => event.target.select()} />
            <button type="button" className="btn" onClick={copyLink}>
              {copyState === "copied" ? "Copied" : "Copy link"}
            </button>
          </div>
          <p className="small muted" aria-live="polite">
            {copyState === "copied"
              ? "Link copied to your clipboard."
              : copyState === "manual"
                ? "Couldn't copy automatically. The link is selected, so press Ctrl+C (or Cmd+C) to copy it."
                : null}
          </p>
          <div className="row">
            <a className="btn btn-ghost btn-sm" href={link} target="_blank" rel="noreferrer">
              Preview your link
            </a>
            {hash ? <TxLink network={network} hash={hash} label="View transaction" /> : null}
          </div>
        </section>
      ) : null}

      <section className="stack" aria-labelledby="sales-title">
        <div className="section-head">
          <div>
            <h2 id="sales-title" className="section-title">
              Your referred sales
            </h2>
            <p className="section-lead">
              {usingSandbox
                ? "Showing sales for the shared sandbox account."
                : "Commissions are paid when a sale is released after its refund window closes."}
            </p>
          </div>
        </div>

        <div className="stats">
          <div className="stat">
            <span className="stat-label">Earnings</span>
            <span className="stat-value num">
              {formatUnits(earnings, decimals)}
              <span className="stat-unit">{symbol}</span>
            </span>
            <span className="stat-hint">Paid out and pending, excluding refunds</span>
          </div>
          <div className="stat">
            <span className="stat-label">Sales referred</span>
            <span className="stat-value num">{sales.length}</span>
            <span className="stat-hint">All time</span>
          </div>
          <div className="stat">
            <span className="stat-label">In refund window</span>
            <span className="stat-value num">{pendingCount}</span>
            <span className="stat-hint">{paidCount} paid out</span>
          </div>
        </div>

        {!salesAccount ? (
          <div className="empty">
            <h3 className="empty-title">Connect your wallet to see your sales</h3>
            <p>Your referred sales and earnings appear here once you sign in.</p>
          </div>
        ) : !salesLoaded ? (
          <p className="loading">Loading your sales…</p>
        ) : sales.length === 0 ? (
          <div className="empty">
            <h3 className="empty-title">No sales yet</h3>
            <p>Share your link to get your first sale. Sales show up here as soon as a buyer pays.</p>
            {link ? (
              <div className="row">
                <button type="button" className="btn btn-ghost" onClick={copyLink}>
                  {copyState === "copied" ? "Copied" : "Copy your link"}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Sales made through your referral links</caption>
              <thead>
                <tr>
                  <th scope="col">Sale</th>
                  <th scope="col">Offer</th>
                  <th scope="col">Buyer</th>
                  <th scope="col" className="num">
                    Your commission
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <tr key={sale.id}>
                    <td className="mono">#{sale.id}</td>
                    <td>{offerTitles.get(sale.offer_id) ?? `Offer #${sale.offer_id}`}</td>
                    <td className="mono small">{sale.buyer}</td>
                    <td className="num">
                      <span className="strong">
                        {formatUnits(sale.creator_amount, decimals)} {symbol}
                      </span>{" "}
                      <span className="muted small">({bpsToPercent(sale.creator_bps)})</span>
                    </td>
                    <td>
                      <span className={`badge badge-dot ${STATUS_CLASS[sale.status] ?? "badge-warn"}`}>
                        {STATUS_LABEL[sale.status] ?? sale.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
