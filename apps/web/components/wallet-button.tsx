"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useWallet } from "@/components/wallet";
import { shortAccount } from "@/lib/format";

/** Compact connect / account button for the site header. */
export function WalletButton() {
  const { accountId, connect, disconnect, connecting, network, error } = useWallet();
  const [open, setOpen] = useState(false);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!accountId) {
    return (
      <div className="wallet-menu">
        <button type="button" className="btn btn-sm" onClick={() => void connect()} disabled={connecting}>
          {connecting ? "Connecting…" : "Connect wallet"}
        </button>
        {error && error !== dismissedError ? (
          <div className="wallet-pop stack-sm" role="alert">
            <p className="error small mb-0">{error}</p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDismissedError(error)}>
              Dismiss
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="wallet-menu" ref={rootRef}>
      <button
        type="button"
        className="btn btn-subtle btn-sm wallet-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={popId}
        onClick={() => setOpen((value) => !value)}
        title={accountId}
      >
        <span className="dot dot-on" aria-hidden="true" />
        <span className="mono">{shortAccount(accountId)}</span>
      </button>
      {open ? (
        <div className="wallet-pop" id={popId}>
          <div className="stack-sm">
            <span className="small muted">Signed in as</span>
            <span className="mono">{accountId}</span>
            <span className="small muted">{network === "testnet" ? "NEAR test network" : "NEAR mainnet"}</span>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-block"
            onClick={() => {
              setOpen(false);
              void disconnect();
            }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
