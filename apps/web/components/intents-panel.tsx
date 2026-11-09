"use client";

import { useEffect, useMemo, useState } from "react";

interface Token {
  assetId: string;
  symbol: string;
  blockchain: string;
  decimals: number;
}

interface QuoteResponse {
  ok?: boolean;
  error?: string;
  dry?: boolean;
  live?: boolean;
  note?: string;
  fee_note?: string;
  quote?: {
    quote?: {
      amountIn?: string;
      amountOut?: string;
      minAmountOut?: string;
      timeEstimate?: number;
    };
    depositAddress?: string;
    depositMemo?: string;
  };
}

export function IntentsPanel({ liveAllowed, jwtConfigured }: { liveAllowed: boolean; jwtConfigured: boolean }) {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [chains, setChains] = useState<string[]>([]);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [originChain, setOriginChain] = useState("eth");
  const [destinationChain, setDestinationChain] = useState("near");
  const [originAsset, setOriginAsset] = useState("");
  const [destinationAsset, setDestinationAsset] = useState("");
  const [amount, setAmount] = useState("1000000");
  const [recipient, setRecipient] = useState("example.near");
  const [refundTo, setRefundTo] = useState("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  const [confirmLive, setConfirmLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuoteResponse | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch("/api/intents/tokens", { cache: "no-store" });
        const payload = (await response.json()) as { tokens?: Token[]; chains?: string[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Token list failed");
        setTokens(payload.tokens ?? []);
        setChains(payload.chains ?? []);
        const firstOrigin = (payload.tokens ?? []).find((token) => token.blockchain === "eth");
        const firstNear = (payload.tokens ?? []).find((token) => token.blockchain === "near");
        if (firstOrigin) {
          setOriginChain(firstOrigin.blockchain);
          setOriginAsset(firstOrigin.assetId);
        }
        if (firstNear) {
          setDestinationChain(firstNear.blockchain);
          setDestinationAsset(firstNear.assetId);
        }
      } catch (err) {
        setTokenError(err instanceof Error ? err.message : "Could not load 1Click tokens");
      }
    })();
  }, []);

  const originOptions = useMemo(
    () => tokens.filter((token) => token.blockchain === originChain).slice(0, 200),
    [tokens, originChain],
  );
  const destinationOptions = useMemo(
    () => tokens.filter((token) => token.blockchain === destinationChain).slice(0, 200),
    [tokens, destinationChain],
  );

  const chosenOrigin = tokens.find((token) => token.assetId === originAsset);
  const chosenDestination = tokens.find((token) => token.assetId === destinationAsset);

  async function quote() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      if (!originAsset || !destinationAsset) throw new Error("Pick an origin and destination asset");
      if (!recipient.trim()) throw new Error("Recipient address is required");
      if (!refundTo.trim()) throw new Error("A refund address on the origin chain is required by 1Click");
      if (!/^\d+$/.test(amount)) throw new Error("Amount must be an integer in the origin token's smallest units");
      const response = await fetch("/api/intents/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originAsset,
          destinationAsset,
          amount,
          recipient: recipient.trim(),
          refundTo: refundTo.trim(),
          confirmLive: liveAllowed && confirmLive,
        }),
      });
      const payload = (await response.json()) as QuoteResponse;
      if (!response.ok) throw new Error(payload.error ?? "Quote failed");
      setResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Quote failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <section className="card stack">
        <div className="row-between">
          <h2>Dry quote</h2>
          <span className="badge">{jwtConfigured ? "partner JWT set" : "unauthenticated (extra fee applies)"}</span>
        </div>

        {tokenError ? <p className="error small">{tokenError}</p> : null}

        <div className="form-grid">
          <div className="field">
            <label htmlFor="origin-chain">Origin chain</label>
            <select
              id="origin-chain"
              value={originChain}
              onChange={(event) => {
                const chain = event.target.value;
                setOriginChain(chain);
                const first = tokens.find((token) => token.blockchain === chain);
                setOriginAsset(first?.assetId ?? "");
              }}
            >
              {chains.map((chain) => (
                <option key={chain} value={chain}>
                  {chain}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="origin-asset">Origin asset</label>
            <select id="origin-asset" value={originAsset} onChange={(event) => setOriginAsset(event.target.value)}>
              {originOptions.map((token) => (
                <option key={token.assetId} value={token.assetId}>
                  {token.symbol} · {token.assetId}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="destination-chain">Destination chain</label>
            <select
              id="destination-chain"
              value={destinationChain}
              onChange={(event) => {
                const chain = event.target.value;
                setDestinationChain(chain);
                const first = tokens.find((token) => token.blockchain === chain);
                setDestinationAsset(first?.assetId ?? "");
              }}
            >
              {chains.map((chain) => (
                <option key={chain} value={chain}>
                  {chain}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="destination-asset">Destination asset</label>
            <select
              id="destination-asset"
              value={destinationAsset}
              onChange={(event) => setDestinationAsset(event.target.value)}
            >
              {destinationOptions.map((token) => (
                <option key={token.assetId} value={token.assetId}>
                  {token.symbol} · {token.assetId}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="amount">
              Amount ({chosenOrigin?.symbol ?? "origin token"}, smallest units)
            </label>
            <input id="amount" value={amount} onChange={(event) => setAmount(event.target.value.trim())} />
          </div>
          <div className="field">
            <label htmlFor="recipient">Recipient ({chosenDestination?.blockchain ?? "destination"} address)</label>
            <input
              id="recipient"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="address that receives this party's share"
            />
          </div>
          <div className="field">
            <label htmlFor="refundTo">Refund address ({chosenOrigin?.blockchain ?? "origin"} chain)</label>
            <input
              id="refundTo"
              value={refundTo}
              onChange={(event) => setRefundTo(event.target.value)}
              placeholder="must be valid on the origin chain"
            />
          </div>
        </div>

        {liveAllowed ? (
          <label className="row small muted">
            <input
              type="checkbox"
              checked={confirmLive}
              onChange={(event) => setConfirmLive(event.target.checked)}
              style={{ width: 16, height: 16 }}
            />
            Live mainnet quote (creates a real deposit address — spends real funds if you deposit)
          </label>
        ) : (
          <p className="muted small">
            Live quotes are disabled on this deployment (<code>CONFIRM_LIVE_INTENTS</code> is not <code>yes</code>).
          </p>
        )}

        <div className="row">
          <button className="btn" onClick={quote} disabled={busy || tokens.length === 0}>
            {busy ? "Quoting…" : "Get quote"}
          </button>
          <span className="muted small">{tokens.length} assets loaded from the live 1Click list</span>
        </div>

        {error ? <p className="error small">{error}</p> : null}

        {result ? (
          <div className="stack">
            <p className={result.live ? "notice" : "notice"}>
              {result.note} {result.fee_note}
            </p>
            <pre className="code">{JSON.stringify(result.quote, null, 2)}</pre>
            {result.quote?.depositAddress ? (
              <p className="small muted">
                Deposit address: <span className="mono">{result.quote.depositAddress}</span>
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
