"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits } from "@/lib/format";

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
      amountInUsd?: string;
      amountOutUsd?: string;
    };
    depositAddress?: string;
    depositMemo?: string;
  };
}

/** Token pair captured at the moment a quote was requested, so the result stays labelled correctly. */
interface QuotedPair {
  origin?: Token;
  destination?: Token;
  amountBase: string;
}

const CHAIN_NAMES: Record<string, string> = {
  near: "NEAR",
  eth: "Ethereum",
  base: "Base",
  arb: "Arbitrum",
  op: "Optimism",
  pol: "Polygon",
  bsc: "BNB Chain",
  avax: "Avalanche",
  gnosis: "Gnosis",
  sol: "Solana",
  btc: "Bitcoin",
  doge: "Dogecoin",
  xrp: "XRP Ledger",
  zec: "Zcash",
  tron: "Tron",
  ton: "TON",
  sui: "Sui",
  aptos: "Aptos",
  stellar: "Stellar",
  cardano: "Cardano",
  bera: "Berachain",
  ltc: "Litecoin",
  bch: "Bitcoin Cash",
};

function chainName(chain: string | undefined): string {
  if (!chain) return "";
  return CHAIN_NAMES[chain] ?? chain.charAt(0).toUpperCase() + chain.slice(1);
}

/** Converts a decimal amount typed by the user ("1.5") into the token's smallest units ("1500000"). */
function toBaseUnits(value: string, decimals: number): string | null {
  const trimmed = value.trim();
  if (!/^\d*(\.\d*)?$/.test(trimmed) || trimmed === "" || trimmed === ".") return null;
  const [whole = "", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) return null;
  return `${whole || "0"}${fraction.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "");
}

function safeUnits(value: string | undefined, decimals: number | undefined): string | null {
  if (!value || decimals === undefined || !/^\d+$/.test(value)) return null;
  try {
    return formatUnits(value, decimals);
  } catch {
    return null;
  }
}

function formatUsd(value: string | undefined): string | null {
  if (value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function formatDuration(seconds: number | undefined): string | null {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 60) return `About ${Math.max(1, Math.round(seconds))} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `About ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `About ${hours} hour${hours === 1 ? "" : "s"}`;
}

/** Labels for an asset dropdown. Symbols that appear twice on one chain get a short id to tell them apart. */
function assetLabels(options: Token[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const token of options) counts.set(token.symbol, (counts.get(token.symbol) ?? 0) + 1);
  const labels = new Map<string, string>();
  for (const token of options) {
    if ((counts.get(token.symbol) ?? 0) > 1) {
      const id = token.assetId.replace(/^nep\d+:/, "");
      const short = id.length > 18 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
      labels.set(token.assetId, `${token.symbol} (${short})`);
    } else {
      labels.set(token.assetId, token.symbol);
    }
  }
  return labels;
}

function cleanReason(message: string): string {
  return message.replace(/^Quote failed:\s*/i, "");
}

export function IntentsPanel({ liveAllowed, jwtConfigured }: { liveAllowed: boolean; jwtConfigured: boolean }) {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [chains, setChains] = useState<string[]>([]);
  const [tokensLoaded, setTokensLoaded] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [originChain, setOriginChain] = useState("near");
  const [destinationChain, setDestinationChain] = useState("base");
  const [originAsset, setOriginAsset] = useState("");
  const [destinationAsset, setDestinationAsset] = useState("");
  const [amountInput, setAmountInput] = useState("1");
  const [recipient, setRecipient] = useState("");
  const [refundTo, setRefundTo] = useState("");
  const [confirmLive, setConfirmLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuoteResponse | null>(null);
  const [quoted, setQuoted] = useState<QuotedPair | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch("/api/intents/tokens", { cache: "no-store" });
        const payload = (await response.json()) as { tokens?: Token[]; chains?: string[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Token list failed");
        setTokens(payload.tokens ?? []);
        setChains(payload.chains ?? []);
        // Default to moving NEAR earnings onward: prefer USDC on each chain, else the first token listed.
        const list = payload.tokens ?? [];
        const pick = (chain: string) =>
          list.find((token) => token.blockchain === chain && token.symbol.toUpperCase() === "USDC") ??
          list.find((token) => token.blockchain === chain);
        const firstNear = pick("near");
        const firstDestination = pick("base") ?? pick("eth");
        if (firstNear) {
          setOriginChain(firstNear.blockchain);
          setOriginAsset(firstNear.assetId);
        }
        if (firstDestination) {
          setDestinationChain(firstDestination.blockchain);
          setDestinationAsset(firstDestination.assetId);
        }
      } catch (err) {
        setTokenError(
          `Couldn't load the list of supported tokens: ${err instanceof Error ? err.message : "unknown error"}. Please refresh to try again.`,
        );
      } finally {
        setTokensLoaded(true);
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
  const originLabels = useMemo(() => assetLabels(originOptions), [originOptions]);
  const destinationLabels = useMemo(() => assetLabels(destinationOptions), [destinationOptions]);

  const chosenOrigin = tokens.find((token) => token.assetId === originAsset);
  const chosenDestination = tokens.find((token) => token.assetId === destinationAsset);
  const liveMode = liveAllowed && confirmLive;

  async function quote() {
    setBusy(true);
    setError(null);
    setResult(null);
    setQuoted(null);
    try {
      if (!originAsset || !destinationAsset || !chosenOrigin) {
        throw new Error("Choose a token to send and a token to receive.");
      }
      if (!recipient.trim()) throw new Error("Enter the address that should receive the payout.");
      if (!refundTo.trim()) {
        throw new Error(
          `Enter a refund address on ${chainName(chosenOrigin.blockchain)}. If the route can't complete, funds go back there.`,
        );
      }
      const amount = toBaseUnits(amountInput, chosenOrigin.decimals);
      if (amount === null || !/^\d+$/.test(amount)) {
        throw new Error(
          `Enter an amount like 25 or 12.5, with at most ${chosenOrigin.decimals} decimal places.`,
        );
      }
      if (/^0+$/.test(amount)) throw new Error("Enter an amount greater than zero.");
      const pair: QuotedPair = { origin: chosenOrigin, destination: chosenDestination, amountBase: amount };
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
      setQuoted(pair);
      setResult(payload);
    } catch (err) {
      setError(`Couldn't get an estimate: ${cleanReason(err instanceof Error ? err.message : "Quote failed")}`);
    } finally {
      setBusy(false);
    }
  }

  const details = result?.quote?.quote;
  const sendAmount = safeUnits(details?.amountIn ?? quoted?.amountBase, quoted?.origin?.decimals);
  const receiveAmount = safeUnits(details?.amountOut, quoted?.destination?.decimals);
  const minimumAmount = safeUnits(details?.minAmountOut, quoted?.destination?.decimals);
  const sendUsd = formatUsd(details?.amountInUsd);
  const receiveUsd = formatUsd(details?.amountOutUsd);
  const costUsd =
    details?.amountInUsd !== undefined && details?.amountOutUsd !== undefined
      ? formatUsd(String(Math.max(0, Number(details.amountInUsd) - Number(details.amountOutUsd))))
      : null;
  const duration = formatDuration(details?.timeEstimate);
  const originSymbol = quoted?.origin?.symbol ?? "";
  const destinationSymbol = quoted?.destination?.symbol ?? "";

  return (
    <section className="card stack" aria-labelledby="estimate-title">
      <div className="card-head">
        <div>
          <h2 id="estimate-title">Get a payout estimate</h2>
          <p className="muted small mb-0">See how much arrives on the other side before you choose a route.</p>
        </div>
        <span className="badge badge-info" title={jwtConfigured ? undefined : "A small extra routing fee applies"}>
          {jwtConfigured ? "Partner pricing" : "Standard pricing"}
        </span>
      </div>

      {tokenError ? (
        <p className="notice notice-error" role="alert">
          {tokenError}
        </p>
      ) : null}
      {!tokensLoaded ? (
        <p className="loading small" role="status">
          Loading supported chains and tokens…
        </p>
      ) : null}

      <div className="grid grid-2">
        <div className="card card-flat card-tight stack-sm">
          <h3 className="mt-0">Send from</h3>
          <div className="field">
            <label htmlFor="origin-chain">Chain</label>
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
                  {chainName(chain)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="origin-asset">Token</label>
            <select id="origin-asset" value={originAsset} onChange={(event) => setOriginAsset(event.target.value)}>
              {originOptions.map((token) => (
                <option key={token.assetId} value={token.assetId}>
                  {originLabels.get(token.assetId) ?? token.symbol}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="amount">Amount{chosenOrigin ? ` (${chosenOrigin.symbol})` : ""}</label>
            <input
              id="amount"
              inputMode="decimal"
              autoComplete="off"
              value={amountInput}
              onChange={(event) => setAmountInput(event.target.value.trim())}
              aria-describedby="amount-hint"
            />
            <p id="amount-hint" className="field-hint">
              The amount of your payout you want to route.
            </p>
          </div>
          <div className="field">
            <label htmlFor="refundTo">Refund address</label>
            <input
              id="refundTo"
              value={refundTo}
              onChange={(event) => setRefundTo(event.target.value)}
              placeholder={`Your ${chainName(chosenOrigin?.blockchain ?? originChain)} address`}
              autoComplete="off"
              spellCheck={false}
              aria-describedby="refund-hint"
            />
            <p id="refund-hint" className="field-hint">
              On {chainName(chosenOrigin?.blockchain ?? originChain)}. If the route can&apos;t complete, funds return
              here.
            </p>
          </div>
        </div>

        <div className="card card-flat card-tight stack-sm">
          <h3 className="mt-0">Receive on</h3>
          <div className="field">
            <label htmlFor="destination-chain">Chain</label>
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
                  {chainName(chain)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="destination-asset">Token</label>
            <select
              id="destination-asset"
              value={destinationAsset}
              onChange={(event) => setDestinationAsset(event.target.value)}
            >
              {destinationOptions.map((token) => (
                <option key={token.assetId} value={token.assetId}>
                  {destinationLabels.get(token.assetId) ?? token.symbol}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="recipient">Recipient address</label>
            <input
              id="recipient"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder={`Your ${chainName(chosenDestination?.blockchain ?? destinationChain)} address`}
              autoComplete="off"
              spellCheck={false}
              aria-describedby="recipient-hint"
            />
            <p id="recipient-hint" className="field-hint">
              The {chainName(chosenDestination?.blockchain ?? destinationChain)} address that receives the payout.
            </p>
          </div>
        </div>
      </div>

      {liveAllowed ? (
        <div className={confirmLive ? "notice notice-warn" : "stack-sm"}>
          <label className="check small" htmlFor="confirm-live">
            <input
              id="confirm-live"
              type="checkbox"
              checked={confirmLive}
              onChange={(event) => setConfirmLive(event.target.checked)}
              style={{ width: 16, height: 16 }}
            />
            Live mode: create a real deposit address
          </label>
          <p className={confirmLive ? "mb-0 small" : "field-hint"}>
            Anything you send to a live deposit address is a real transfer on mainnet. Leave this off to get an
            estimate only.
          </p>
        </div>
      ) : (
        <p className="muted small">Estimates only. No deposit address is created and no funds move.</p>
      )}

      <div className="row">
        <button type="button" className="btn" onClick={quote} disabled={busy || tokens.length === 0}>
          {busy ? "Getting estimate…" : liveMode ? "Get live quote" : "Get estimate"}
        </button>
        {tokens.length > 0 ? (
          <span className="muted small">
            {tokens.length.toLocaleString("en-US")} tokens across {chains.length} chains
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="stack" role="status" aria-live="polite">
          {result.live ? (
            <div className="notice notice-warn">
              <p className="notice-title">Live quote</p>
              <p className="mb-0">
                Sending funds to the deposit address below is a real transfer on mainnet. Send only the amount shown.
              </p>
            </div>
          ) : (
            <div className="notice notice-info">
              <p className="notice-title">Estimate only</p>
              <p className="mb-0">The route was checked and priced. No deposit address was created and no funds moved.</p>
            </div>
          )}

          <div className="split">
            <div className="split-cell">
              <span>You send</span>
              <strong className="num">
                {sendAmount ?? "—"} {originSymbol}
              </strong>
              <span>
                {chainName(quoted?.origin?.blockchain)}
                {sendUsd ? ` · ${sendUsd}` : ""}
              </span>
            </div>
            <div className="split-cell is-creator">
              <span>You receive</span>
              <strong className="num">
                {receiveAmount ? `≈ ${receiveAmount}` : "—"} {destinationSymbol}
              </strong>
              <span>
                {chainName(quoted?.destination?.blockchain)}
                {receiveUsd ? ` · ${receiveUsd}` : ""}
              </span>
            </div>
          </div>

          <dl className="kv">
            {minimumAmount ? (
              <>
                <dt>Minimum you receive</dt>
                <dd className="num">
                  {minimumAmount} {destinationSymbol}
                </dd>
              </>
            ) : null}
            {costUsd ? (
              <>
                <dt>Estimated routing cost</dt>
                <dd className="num">{costUsd}, including fees and price movement</dd>
              </>
            ) : null}
            <dt>Fees</dt>
            <dd>
              {jwtConfigured
                ? "Partner pricing applies."
                : "Standard pricing: NEAR Intents adds a small extra routing fee (around 0.2–0.25%)."}
            </dd>
            {duration ? (
              <>
                <dt>Estimated time</dt>
                <dd>{duration}</dd>
              </>
            ) : null}
            {result.quote?.depositAddress ? (
              <>
                <dt>Deposit address</dt>
                <dd className="mono">{result.quote.depositAddress}</dd>
              </>
            ) : null}
            {result.quote?.depositMemo ? (
              <>
                <dt>Deposit memo</dt>
                <dd className="mono">{result.quote.depositMemo}</dd>
              </>
            ) : null}
          </dl>

          <details className="details">
            <summary>Technical details</summary>
            <div className="details-body">
              <p>
                Amount sent to the quote service in the token&apos;s smallest units:{" "}
                <span className="mono">{quoted?.amountBase ?? "—"}</span>. Full response from the NEAR Intents 1Click
                API:
              </p>
              <pre className="code">{JSON.stringify(result.quote, null, 2)}</pre>
            </div>
          </details>
        </div>
      ) : null}
    </section>
  );
}
