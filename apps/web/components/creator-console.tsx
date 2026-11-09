"use client";

import { useCallback, useEffect, useState } from "react";
import { TxLink } from "@/components/explorer";
import { WalletBar, useWallet } from "@/components/wallet";
import { bpsToPercent, formatUnits } from "@/lib/format";
import type { Sale } from "@/lib/types";

interface OfferSummary {
  id: number;
  title: string;
  commission_bps: number;
  paused: boolean;
}

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
  const [code, setCode] = useState("ada");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hash, setHash] = useState<string | undefined>();
  const [link, setLink] = useState<string | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [earnings, setEarnings] = useState("0");

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
    }
  }, [accountId, demoMode, demoCreator]);

  useEffect(() => {
    void loadSales();
  }, [loadSales]);

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
      if (!Number.isInteger(id) || id < 1) throw new Error("Pick an offer");
      const referral = code.trim();
      if (!/^[a-z0-9_-]{1,32}$/i.test(referral)) throw new Error("Code must be 1–32 letters, numbers, '-' or '_'");

      if (accountId) {
        const result = await call({
          methodName: "register_creator",
          args: { offer_id: id, code: referral, payout_account: null, commission_bps_override: null },
          gasTgas: 30,
        });
        setHash(result.hash);
        setNotice("Claimed from your wallet.");
      } else if (demoMode) {
        const response = await fetch("/api/demo/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offerId: id, code: referral }),
        });
        const payload = (await response.json()) as { error?: string; mode?: string; account?: string; outcome?: { transaction?: { hash?: string } } };
        if (!response.ok) throw new Error(payload.error ?? "Claim failed");
        setHash(payload.outcome?.transaction?.hash);
        setNotice(
          payload.mode === "meta-tx"
            ? `Claimed as ${payload.account} through the relayer — the creator paid no gas.`
            : `Claimed directly as ${payload.account} (no relayer configured).`,
        );
      } else {
        throw new Error("Connect a wallet, or enable DEMO_MODE with a seeded creator.");
      }

      setLink(buildLink(id, referral));
      await loadSales();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Claim failed");
    } finally {
      setBusy(null);
    }
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setNotice("Link copied.");
    } catch {
      setNotice(link);
    }
  }

  return (
    <div className="stack">
      <WalletBar demoAccounts={demoMode ? { merchant: null, creator: demoCreator, buyer: null } : undefined} />

      <section className="card stack">
        <div className="row-between">
          <h2>Claim a referral code</h2>
          <span className={`badge ${relayerConfigured ? "badge-ok" : "badge-warn"}`}>
            {relayerConfigured ? "relayer configured · gasless" : "no relayer · you pay gas"}
          </span>
        </div>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="offer">Offer</label>
            <select id="offer" value={offerId} onChange={(event) => setOfferId(event.target.value)}>
              {offers.length === 0 ? <option value="">No offers yet</option> : null}
              {offers.map((offer) => (
                <option key={offer.id} value={offer.id}>
                  #{offer.id} · {offer.title} · {bpsToPercent(offer.commission_bps)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="code">Your code</label>
            <input id="code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="ada" />
          </div>
        </div>

        <div className="row">
          <button className="btn" onClick={claim} disabled={busy !== null || !contractId || !offerId}>
            {busy === "claim" ? "Claiming…" : accountId ? "Claim with wallet" : demoMode ? "Claim gaslessly (demo creator)" : "Connect wallet to claim"}
          </button>
          {link ? (
            <>
              <input readOnly value={link} className="mono" style={{ maxWidth: 420 }} />
              <button className="btn btn-ghost" onClick={copyLink}>
                Copy link
              </button>
            </>
          ) : null}
        </div>

        {error ? <p className="error small">{error}</p> : null}
        {notice ? (
          <p className="notice">
            {notice} {hash ? <TxLink network={network} hash={hash} /> : null}
          </p>
        ) : null}
        <p className="muted small">
          Without a wallet this demo claims as <span className="mono">{demoCreator ?? "—"}</span>, the seeded creator
          persona. The contract records that account as the referral owner.
        </p>
      </section>

      <section className="card stack">
        <div className="row-between">
          <h2>Attributed sales</h2>
          <span className="muted small">
            earned {formatUnits(earnings, decimals)} {symbol}
          </span>
        </div>
        {sales.length === 0 ? (
          <p className="muted small">
            No sales attributed yet. Share the link; sales show up here after a buyer pays.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sale</th>
                  <th>Offer</th>
                  <th>Buyer</th>
                  <th>Commission</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <tr key={sale.id}>
                    <td className="mono">#{sale.id}</td>
                    <td>#{sale.offer_id}</td>
                    <td className="mono small">{sale.buyer}</td>
                    <td>
                      {formatUnits(sale.creator_amount, decimals)} {symbol} ({bpsToPercent(sale.creator_bps)})
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          sale.status === "Released" ? "badge-ok" : sale.status === "Refunded" ? "badge-danger" : "badge-warn"
                        }`}
                      >
                        {sale.status}
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
