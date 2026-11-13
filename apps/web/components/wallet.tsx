"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/** Minimal surface of a connected NEAR Connect wallet. */
interface ConnectedWallet {
  getAccounts: () => Promise<{ accountId: string }[]>;
  signAndSendTransaction: (params: {
    receiverId: string;
    actions: {
      type: "FunctionCall";
      params: {
        methodName: string;
        args: Record<string, unknown>;
        gas: string;
        deposit: string;
      };
    }[];
  }) => Promise<{ transaction?: { hash?: string } } | undefined>;
}

interface ConnectorLike {
  connect: () => Promise<ConnectedWallet | undefined>;
  disconnect: (wallet: ConnectedWallet) => Promise<void>;
  wallet: () => Promise<ConnectedWallet>;
  on: (event: string, handler: (payload: { accounts?: { accountId: string }[] }) => void) => void;
  off: (event: string, handler: (payload: { accounts?: { accountId: string }[] }) => void) => void;
}

export interface CallResult {
  hash?: string;
}

interface WalletContextValue {
  accountId: string;
  network: "testnet" | "mainnet";
  contractId: string;
  ready: boolean;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  call: (params: {
    receiverId?: string;
    methodName: string;
    args?: Record<string, unknown>;
    gasTgas?: number;
    depositYocto?: string;
  }) => Promise<CallResult>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({
  network,
  contractId,
  children,
}: {
  network: "testnet" | "mainnet";
  contractId: string;
  children: React.ReactNode;
}) {
  const connectorRef = useRef<ConnectorLike | null>(null);
  const [accountId, setAccountId] = useState("");
  const [ready, setReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let connector: ConnectorLike | null = null;

    const handleSignIn = (payload: { accounts?: { accountId: string }[] }) => {
      if (cancelled) return;
      setAccountId(payload.accounts?.[0]?.accountId ?? "");
    };
    const handleSignOut = () => {
      if (!cancelled) setAccountId("");
    };

    (async () => {
      try {
        const module = (await import("@hot-labs/near-connect")) as unknown as {
          NearConnector: new (options: {
            network: string;
            features?: { signAndSendTransaction?: boolean };
          }) => ConnectorLike;
        };
        // Only list wallets that can sign and send transactions. The library already hides
        // wallets that don't support the test network when network is "testnet".
        connector = new module.NearConnector({ network, features: { signAndSendTransaction: true } });
        connector.on("wallet:signIn", handleSignIn);
        connector.on("wallet:signOut", handleSignOut);
        connectorRef.current = connector;
        try {
          const existing = await connector.wallet();
          const accounts = await existing.getAccounts();
          if (!cancelled) setAccountId(accounts[0]?.accountId ?? "");
        } catch {
          // No prior session — expected on a first visit.
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            `Wallet sign-in couldn't load${err instanceof Error && err.message ? `: ${err.message}` : "."} Refresh the page to try again.`,
          );
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
      if (connector) {
        connector.off("wallet:signIn", handleSignIn);
        connector.off("wallet:signOut", handleSignOut);
      }
    };
  }, [network]);

  const connect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      const connector = connectorRef.current;
      if (!connector) throw new Error("Wallet sign-in is still loading. Try again in a moment.");
      const wallet = await connector.connect();
      if (wallet) {
        const accounts = await wallet.getAccounts();
        setAccountId(accounts[0]?.accountId ?? "");
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : "";
      setError(reason ? `Couldn't connect your wallet: ${reason}` : "Couldn't connect your wallet. Please try again.");
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    const connector = connectorRef.current;
    if (!connector) return;
    try {
      const wallet = await connector.wallet();
      await connector.disconnect(wallet);
    } catch {
      // Already disconnected.
    }
    setAccountId("");
  }, []);

  const call = useCallback(
    async (params: {
      receiverId?: string;
      methodName: string;
      args?: Record<string, unknown>;
      gasTgas?: number;
      depositYocto?: string;
    }) => {
      const connector = connectorRef.current;
      if (!connector) throw new Error("Wallet sign-in is still loading. Try again in a moment.");
      const target = params.receiverId ?? contractId;
      if (!target) throw new Error("This service is temporarily unavailable. Please try again shortly.");
      const wallet = await connector.wallet();
      const result = await wallet.signAndSendTransaction({
        receiverId: target,
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: params.methodName,
              args: params.args ?? {},
              gas: ((params.gasTgas ?? 50) * 1_000_000_000_000).toString(),
              deposit: params.depositYocto ?? "0",
            },
          },
        ],
      });
      return { hash: result?.transaction?.hash };
    },
    [contractId],
  );

  const value = useMemo<WalletContextValue>(
    () => ({
      accountId,
      network,
      contractId,
      ready,
      connecting,
      error,
      connect,
      disconnect,
      call,
    }),
    [accountId, network, contractId, ready, connecting, error, connect, disconnect, call],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside WalletProvider");
  return context;
}

export function WalletBar({ demoAccounts }: { demoAccounts?: { merchant: string | null; creator: string | null; buyer: string | null } }) {
  const { accountId, connect, disconnect, connecting, error, network } = useWallet();
  return (
    <div className="walletbar" role="region" aria-label="Wallet">
      <div className="walletbar-info">
        {accountId ? (
          <>
            <span className="dot dot-on" aria-hidden="true" />
            <div className="walletbar-body">
              <span className="small muted">Signed in as</span>
              <span className="mono">{accountId}</span>
            </div>
            <span className={`badge ${network === "testnet" ? "badge-warn" : "badge-ok"}`}>
              {network === "testnet" ? "Test network" : "Mainnet"}
            </span>
          </>
        ) : (
          <>
            <span className="dot" aria-hidden="true" />
            <div className="walletbar-body">
              <span>Connect a NEAR wallet to continue</span>
              {demoAccounts ? (
                <span className="muted small">No wallet? You can continue with a sandbox account.</span>
              ) : null}
            </div>
          </>
        )}
      </div>
      {accountId ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={disconnect}>
          Sign out
        </button>
      ) : (
        <button type="button" className="btn btn-sm" onClick={connect} disabled={connecting}>
          {connecting ? "Connecting…" : "Connect wallet"}
        </button>
      )}
      {error ? (
        <p className="error small walletbar-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
