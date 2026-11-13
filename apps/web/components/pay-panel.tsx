"use client";

import { useCallback, useEffect, useState } from "react";
import { TxLink } from "@/components/explorer";
import { friendlyReason } from "@/components/friendly-error";
import { refundWindowLabel } from "@/components/offer-format";
import styles from "@/components/offer.module.css";
import { WalletBar, useWallet } from "@/components/wallet";
import { bpsToPercent, formatDate, formatUnits } from "@/lib/format";
import type { Offer, Sale, SplitPreview } from "@/lib/types";

function reason(err: unknown, fallback: string): string {
  const message = friendlyReason(err instanceof Error ? err.message : "", fallback).replace(/[.\s]+$/, "");
  // Lower-case the first letter of sentence-style messages ("Something went wrong"), not acronyms ("NEAR …").
  return /^[A-Z][a-z]/.test(message) ? message.charAt(0).toLowerCase() + message.slice(1) : message;
}

const STATUS_LABEL: Record<Sale["status"], string> = {
  Pending: "In refund window",
  Released: "Paid out",
  Refunded: "Refunded",
};

function statusBadge(status: Sale["status"]): string {
  if (status === "Released") return "badge-ok";
  if (status === "Refunded") return "badge-danger";
  return "badge-warn";
}

export function PayPanel({
  offer,
  preview,
  initialRef,
  decimals,
  symbol,
  contractId,
  ftAccount,
  treasury,
  demoMode,
  demoBuyer,
}: {
  offer: Offer;
  preview: SplitPreview | null;
  initialRef: string;
  decimals: number;
  symbol: string;
  contractId: string;
  ftAccount: string;
  treasury: string;
  demoMode: boolean;
  demoBuyer: string | null;
}) {
  const { accountId, network, call } = useWallet();
  const [ref, setRef] = useState(initialRef);
  const [currentPreview, setCurrentPreview] = useState<SplitPreview | null>(preview);
  const [saleId, setSaleId] = useState<number | null>(null);
  const [sale, setSale] = useState<Sale | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ title: string; body?: string } | null>(null);
  const [hash, setHash] = useState<string | undefined>();

  const refreshPreview = useCallback(
    async (code: string) => {
      try {
        const url = `/api/preview?offer=${offer.id}${code ? `&ref=${encodeURIComponent(code)}` : ""}`;
        const response = await fetch(url, { cache: "no-store" });
        const payload = (await response.json()) as { preview?: SplitPreview; error?: string };
        if (response.ok) setCurrentPreview(payload.preview ?? null);
      } catch {
        // Keep the last good preview.
      }
    },
    [offer.id],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshPreview(ref);
    }, 250);
    return () => clearTimeout(timer);
  }, [ref, refreshPreview]);

  const pollSale = useCallback(async (id: number) => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        const response = await fetch(`/api/sale?id=${id}`, { cache: "no-store" });
        if (response.ok) {
          const payload = (await response.json()) as { sale?: Sale };
          if (payload.sale) {
            setSale(payload.sale);
            if (payload.sale.status !== "Pending" || Date.now() * 1_000_000 >= Number(payload.sale.release_at_ns)) {
              return;
            }
          }
        }
      } catch {
        // keep polling
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }, []);

  async function pay() {
    setBusy("pay");
    setError(null);
    setNotice(null);
    try {
      if (!contractId || !ftAccount) throw new Error("Checkout isn't set up on this site yet");
      if (accountId) {
        const result = await call({
          receiverId: ftAccount,
          methodName: "ft_transfer_call",
          args: {
            receiver_id: contractId,
            amount: offer.price,
            msg: JSON.stringify({ offer_id: offer.id, ...(ref ? { ref } : {}) }),
          },
          gasTgas: 100,
          depositYocto: "1",
        });
        setHash(result.hash);
        setNotice({
          title: "Payment sent",
          body: "Your payment is held in escrow while it's confirmed. You can check its progress on the network explorer.",
        });
      } else if (demoMode) {
        const response = await fetch("/api/demo/buy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offerId: offer.id, ref: ref || null }),
        });
        const payload = (await response.json()) as { error?: string; sale_id?: number | null; outcome?: { transaction?: { hash?: string } } };
        if (!response.ok) throw new Error(payload.error ?? "Something went wrong");
        setHash(payload.outcome?.transaction?.hash);
        setNotice({
          title: "Payment sent from the sandbox account",
          body: "Your payment is held in escrow. Your order details appear below.",
        });
        if (payload.sale_id) {
          setSaleId(payload.sale_id);
          void pollSale(payload.sale_id);
        }
      } else {
        throw new Error("Connect a wallet first");
      }
    } catch (err) {
      setError(`Couldn't complete the payment: ${reason(err, "Something went wrong")}.`);
    } finally {
      setBusy(null);
    }
  }

  async function release() {
    if (!sale) return;
    setBusy("release");
    setError(null);
    try {
      const response = await fetch("/api/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saleId: sale.id }),
      });
      const payload = (await response.json()) as { error?: string; outcome?: { transaction?: { hash?: string } } };
      if (!response.ok) throw new Error(payload.error ?? "Something went wrong");
      setHash(payload.outcome?.transaction?.hash);
      setNotice({ title: "Payout complete", body: "The seller, the creator and the service fee have been paid." });
      await pollSale(sale.id);
    } catch (err) {
      setError(`Couldn't release the payout: ${reason(err, "Something went wrong")}.`);
    } finally {
      setBusy(null);
    }
  }

  async function faucet() {
    if (!accountId) return;
    setBusy("faucet");
    setError(null);
    try {
      const response = await fetch("/api/demo/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: accountId }),
      });
      const payload = (await response.json()) as { error?: string; amount?: string };
      if (!response.ok) throw new Error(payload.error ?? "Something went wrong");
      setNotice({
        title: "Test tokens sent",
        body: payload.amount
          ? `We sent ${formatUnits(payload.amount, decimals)} ${symbol} to your wallet.`
          : `We sent ${symbol} test tokens to your wallet.`,
      });
    } catch (err) {
      setError(`Couldn't send test tokens: ${reason(err, "Something went wrong")}.`);
    } finally {
      setBusy(null);
    }
  }

  const unknownRef = Boolean(ref) && currentPreview !== null && !currentPreview.known_creator;
  const split = currentPreview;
  const price = formatUnits(offer.price, decimals);
  const refundWindow = refundWindowLabel(offer.refund_hold_ns);

  const merchantBps = split ? Math.max(0, 10_000 - split.creator_bps - split.protocol_bps) : 0;
  const segments = split
    ? [
        { key: "merchant", label: "Seller", bps: merchantBps, amount: split.merchant_amount },
        { key: "creator", label: "Creator", bps: split.creator_bps, amount: split.creator_amount },
        { key: "protocol", label: "Service fee", bps: split.protocol_bps, amount: split.protocol_amount },
      ]
    : [];

  const payLabel =
    busy === "pay"
      ? "Processing payment…"
      : accountId
        ? `Pay ${price} ${symbol}`
        : demoMode
          ? "Pay with sandbox account"
          : "Connect wallet to pay";

  const releaseDue = sale !== null && sale.status === "Pending" && Date.now() * 1_000_000 >= Number(sale.release_at_ns);

  return (
    <div className="stack">
      <WalletBar demoAccounts={demoMode ? { merchant: null, creator: null, buyer: demoBuyer } : undefined} />

      <section className="card stack" aria-labelledby="checkout-title">
        <div className="card-head">
          <h2 id="checkout-title">Checkout</h2>
          <span className={`badge badge-dot ${offer.paused ? "badge-warn" : "badge-ok"}`}>
            {offer.paused ? "Paused" : "Live"}
          </span>
        </div>

        <div className={styles.total}>
          <span className={styles.totalLabel}>Total</span>
          <span className={styles.totalValue}>
            {price}
            <span className="price-unit">{symbol}</span>
          </span>
        </div>

        <dl className="kv">
          <dt>Refund window</dt>
          <dd>{refundWindow ?? "None, payment settles right away"}</dd>
          <dt>Creator commission</dt>
          <dd>{bpsToPercent(offer.commission_bps)}</dd>
          <dt>Service fee</dt>
          <dd>{bpsToPercent(offer.protocol_fee_bps)}</dd>
        </dl>

        <div className="field">
          <label htmlFor="ref">Referral code</label>
          <input
            id="ref"
            value={ref}
            onChange={(event) => setRef(event.target.value.trim())}
            placeholder="Optional, e.g. ada"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="ref-hint"
            aria-invalid={unknownRef || undefined}
          />
          <p id="ref-hint" className="field-hint">
            Filled in from your creator&apos;s link. Leave it blank if nobody referred you.
          </p>
        </div>

        {unknownRef ? (
          <p className="notice notice-warn" role="alert">
            <span className="notice-title">We don&apos;t recognise this referral code</span>
            A payment with an unknown code would be refunded automatically. Check the code, or clear the field to pay
            without one.
          </p>
        ) : null}

        <div className="stack-sm">
          <h3 className="mb-0">Where your payment goes</h3>
          {split ? (
            <>
              <div
                className="splitbar"
                role="img"
                aria-label={segments.map((segment) => `${segment.label} ${bpsToPercent(segment.bps)}`).join(", ")}
              >
                {segments
                  .filter((segment) => segment.bps > 0)
                  .map((segment) => (
                    <span
                      key={segment.key}
                      className={`splitbar-seg seg-${segment.key}`}
                      style={{ width: `${segment.bps / 100}%` }}
                    />
                  ))}
              </div>
              <div className="split">
                <div className="split-cell is-merchant">
                  <span>Seller · {bpsToPercent(merchantBps)}</span>
                  <strong>
                    {formatUnits(split.merchant_amount, decimals)} {symbol}
                  </strong>
                  <span className={styles.cellAccount}>{split.merchant_payout}</span>
                </div>
                <div className="split-cell is-creator">
                  <span>Creator · {bpsToPercent(split.creator_bps)}</span>
                  <strong>
                    {formatUnits(split.creator_amount, decimals)} {symbol}
                  </strong>
                  <span className={styles.cellAccount}>{split.creator_payout ?? "No referral code"}</span>
                </div>
                <div className="split-cell is-protocol">
                  <span>Service fee · {bpsToPercent(split.protocol_bps)}</span>
                  <strong>
                    {formatUnits(split.protocol_amount, decimals)} {symbol}
                  </strong>
                  <span className={styles.cellAccount}>{treasury || "ReferRail"}</span>
                </div>
              </div>
            </>
          ) : (
            <p className="muted small">
              The payment breakdown isn&apos;t available right now. The total above is what you&apos;ll pay.
            </p>
          )}
        </div>

        {offer.paused ? (
          <p className="notice notice-warn">
            <span className="notice-title">This offer is paused</span>
            The seller isn&apos;t taking payments for it right now. Check back later.
          </p>
        ) : null}

        <div className={styles.actions}>
          <button
            type="button"
            className="btn btn-lg btn-block"
            onClick={pay}
            disabled={busy !== null || offer.paused || unknownRef || !contractId}
          >
            {payLabel}
          </button>
          {demoMode && accountId ? (
            <button type="button" className="btn btn-ghost btn-block" onClick={faucet} disabled={busy !== null}>
              {busy === "faucet" ? "Sending tokens…" : "Get test tokens"}
            </button>
          ) : null}
          {demoMode && !accountId ? (
            <p className="sandbox-note">Uses a shared sandbox account on the test network.</p>
          ) : null}
        </div>

        {error ? (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="notice notice-success" role="status">
            <span className="notice-title">{notice.title}</span>
            {notice.body}{" "}
            {hash ? <TxLink network={network} hash={hash} label="View transaction" /> : null}
          </p>
        ) : null}
      </section>

      {sale || saleId ? (
        <section className="card card-accent stack" aria-labelledby="order-title" aria-live="polite">
          <div className="card-head">
            <div>
              <h2 id="order-title">{sale ? "Order confirmed" : "Confirming your order"}</h2>
              <p className="muted small mb-0">Reference #{sale?.id ?? saleId}</p>
            </div>
            {sale ? (
              <span className={`badge badge-dot ${statusBadge(sale.status)}`}>
                {STATUS_LABEL[sale.status] ?? sale.status}
              </span>
            ) : (
              <span className="badge badge-dot">Confirming</span>
            )}
          </div>
          {sale ? (
            <>
              <dl className="kv">
                <dt>Amount paid</dt>
                <dd>
                  {formatUnits(sale.amount, decimals)} {symbol}
                </dd>
                {sale.creator_code ? (
                  <>
                    <dt>Referred by</dt>
                    <dd className="mono">{sale.creator_code}</dd>
                  </>
                ) : null}
                <dt>{sale.status === "Pending" ? "Payout available from" : "Status"}</dt>
                <dd>
                  {sale.status === "Pending"
                    ? formatDate(sale.release_at_ns)
                    : sale.status === "Released"
                      ? "Paid out"
                      : "Refunded"}
                </dd>
                {hash ? (
                  <>
                    <dt>Transaction</dt>
                    <dd>
                      <TxLink network={network} hash={hash} label="View on explorer" />
                    </dd>
                  </>
                ) : null}
              </dl>
              <div className="split">
                <div className="split-cell is-merchant">
                  <span>Seller</span>
                  <strong>
                    {formatUnits(sale.merchant_amount, decimals)} {symbol}
                  </strong>
                </div>
                <div className="split-cell is-creator">
                  <span>Creator</span>
                  <strong>
                    {formatUnits(sale.creator_amount, decimals)} {symbol}
                  </strong>
                </div>
                <div className="split-cell is-protocol">
                  <span>Service fee</span>
                  <strong>
                    {formatUnits(sale.protocol_amount, decimals)} {symbol}
                  </strong>
                </div>
              </div>
              <p className="muted small mb-0">
                {sale.status === "Pending"
                  ? `Your payment is held in escrow until ${formatDate(sale.release_at_ns)}. After that, it can be released to the seller and the creator.`
                  : sale.status === "Released"
                    ? "This payment has been paid out to the seller and the creator."
                    : "This payment was refunded."}
              </p>
              {releaseDue ? (
                <button type="button" className="btn" onClick={release} disabled={busy !== null}>
                  {busy === "release" ? "Releasing payout…" : "Release payout now"}
                </button>
              ) : null}
            </>
          ) : (
            <p className="loading">Confirming your payment…</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
