"use client";

import { useCallback, useEffect, useState } from "react";
import { TxLink } from "@/components/explorer";
import { WalletBar, useWallet } from "@/components/wallet";
import { bpsToPercent, formatDate, formatUnits, holdLabel } from "@/lib/format";
import type { Offer, Sale, SplitPreview } from "@/lib/types";

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
  const [notice, setNotice] = useState<string | null>(null);
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
      if (!contractId || !ftAccount) throw new Error("This deployment is not configured with a contract and token");
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
        setNotice("Paid from your wallet. The escrow receipt is settling; the sale appears below.");
      } else if (demoMode) {
        const response = await fetch("/api/demo/buy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offerId: offer.id, ref: ref || null }),
        });
        const payload = (await response.json()) as { error?: string; sale_id?: number | null; outcome?: { transaction?: { hash?: string } } };
        if (!response.ok) throw new Error(payload.error ?? "Payment failed");
        setHash(payload.outcome?.transaction?.hash);
        setNotice(`Paid by the seeded demo buyer (${demoBuyer}).`);
        if (payload.sale_id) {
          setSaleId(payload.sale_id);
          void pollSale(payload.sale_id);
        }
      } else {
        throw new Error("Connect a wallet, or enable DEMO_MODE with a seeded buyer.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
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
      if (!response.ok) throw new Error(payload.error ?? "Release failed");
      setHash(payload.outcome?.transaction?.hash);
      setNotice("Released: merchant, creator and treasury paid.");
      await pollSale(sale.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Release failed");
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
      if (!response.ok) throw new Error(payload.error ?? "Faucet failed");
      setNotice(`Test tokens sent: ${payload.amount ? formatUnits(payload.amount, decimals) : ""} ${symbol}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Faucet failed");
    } finally {
      setBusy(null);
    }
  }

  const unknownRef = Boolean(ref) && currentPreview !== null && !currentPreview.known_creator;
  const split = currentPreview;

  return (
    <div className="stack">
      <WalletBar demoAccounts={demoMode ? { merchant: null, creator: null, buyer: demoBuyer } : undefined} />

      <section className="card stack">
        <div className="row-between">
          <div>
            <h2>
              Pay {formatUnits(offer.price, decimals)} {symbol}
            </h2>
            <p className="muted small">
              {bpsToPercent(offer.commission_bps)} to creators · {bpsToPercent(offer.protocol_fee_bps)} protocol ·
              refund hold {holdLabel(offer.refund_hold_ns)}
            </p>
          </div>
          <span className={`badge ${offer.paused ? "badge-warn" : "badge-ok"}`}>{offer.paused ? "paused" : "live"}</span>
        </div>

        <div className="field">
          <label htmlFor="ref">Referral code (from your creator&apos;s link)</label>
          <input
            id="ref"
            value={ref}
            onChange={(event) => setRef(event.target.value.trim())}
            placeholder="e.g. ada"
          />
        </div>

        {split ? (
          <div className="split">
            <div className="split-cell">
              <span>Merchant · {split.merchant_payout}</span>
              <strong>
                {formatUnits(split.merchant_amount, decimals)} {symbol}
              </strong>
            </div>
            <div className="split-cell">
              <span>Creator · {split.creator_payout ?? "no referral code"}</span>
              <strong>
                {formatUnits(split.creator_amount, decimals)} {symbol}
              </strong>
            </div>
            <div className="split-cell">
              <span>Protocol · {treasury || "treasury"}</span>
              <strong>
                {formatUnits(split.protocol_amount, decimals)} {symbol}
              </strong>
            </div>
          </div>
        ) : (
          <p className="muted small">Split preview unavailable (contract not configured or unreachable).</p>
        )}

        {unknownRef ? (
          <p className="notice">Unknown referral code: the contract would refuse this payment and refund it. Fix the code first.</p>
        ) : null}

        <div className="row">
          <button
            className="btn"
            onClick={pay}
            disabled={busy !== null || offer.paused || unknownRef || !contractId}
          >
            {busy === "pay" ? "Paying…" : accountId ? "Pay with wallet" : demoMode ? "Pay as demo buyer" : "Connect wallet to pay"}
          </button>
          {demoMode && accountId ? (
            <button className="btn btn-ghost" onClick={faucet} disabled={busy !== null}>
              {busy === "faucet" ? "Minting…" : `Get test ${symbol}`}
            </button>
          ) : null}
          {demoMode && !accountId ? (
            <span className="muted small">
              No wallet? The demo buyer ({demoBuyer}) can pay for you with one click.
            </span>
          ) : null}
        </div>

        {error ? <p className="error small">{error}</p> : null}
        {notice ? (
          <p className="notice">
            {notice} {hash ? <TxLink network={network} hash={hash} /> : null}
          </p>
        ) : null}
      </section>

      {sale || saleId ? (
        <section className="card stack">
          <div className="row-between">
            <h3>Sale #{sale?.id ?? saleId}</h3>
            {sale ? (
              <span
                className={`badge ${
                  sale.status === "Released" ? "badge-ok" : sale.status === "Refunded" ? "badge-danger" : "badge-warn"
                }`}
              >
                {sale.status}
              </span>
            ) : (
              <span className="badge">settling…</span>
            )}
          </div>
          {sale ? (
            <>
              <div className="split">
                <div className="split-cell">
                  <span>Merchant</span>
                  <strong>{formatUnits(sale.merchant_amount, decimals)}</strong>
                </div>
                <div className="split-cell">
                  <span>Creator</span>
                  <strong>{formatUnits(sale.creator_amount, decimals)}</strong>
                </div>
                <div className="split-cell">
                  <span>Protocol</span>
                  <strong>{formatUnits(sale.protocol_amount, decimals)}</strong>
                </div>
              </div>
              <p className="muted small">
                {sale.status === "Pending"
                  ? `Release allowed from ${formatDate(sale.release_at_ns)} (anyone can call release).`
                  : "Settled on-chain."}
              </p>
              {sale.status === "Pending" && Date.now() * 1_000_000 >= Number(sale.release_at_ns) ? (
                <button className="btn" onClick={release} disabled={busy !== null}>
                  {busy === "release" ? "Releasing…" : "Release the split now"}
                </button>
              ) : null}
            </>
          ) : (
            <p className="muted small">Waiting for the contract to record the sale…</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
