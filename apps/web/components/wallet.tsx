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
          NearConnector: new (options: { network: string }) => ConnectorLike;
        };
        connector = new module.NearConnector({ network });
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
          setError(err instanceof Error ? err.message : "Wallet connector failed to load");
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
      if (!connector) throw new Error("Wallet connector is still loading");
      const wallet = await connector.connect();
      if (wallet) {
        const accounts = await wallet.getAccounts();
        setAccountId(accounts[0]?.accountId ?? "");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect a wallet");
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
      if (!connector) throw new Error("Wallet connector is still loading");
      const target = params.receiverId ?? contractId;
      if (!target) throw new Error("No contract id configured");
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
    <div className="walletbar">
      <div className="walletbar-info">
        {accountId ? (
          <>
            <span className="dot dot-on" />
            <span className="mono">{accountId}</span>
            <span className="badge">{network}</span>
          </>
        ) : (
          <>
            <span className="dot" />
            <span>No wallet connected</span>
            {demoAccounts ? (
              <span className="muted small">
                demo personas: {demoAccounts.merchant ?? "—"} / {demoAccounts.creator ?? "—"} /{" "}
                {demoAccounts.buyer ?? "—"}
              </span>
            ) : null}
          </>
        )}
      </div>
      {accountId ? (
        <button className="btn btn-ghost" onClick={disconnect}>
          Sign out
        </button>
      ) : (
        <button className="btn" onClick={connect} disabled={connecting}>
          {connecting ? "Connecting…" : "Connect NEAR wallet"}
        </button>
      )}
      {error ? <p className="error small">{error}</p> : null}
    </div>
  );
}
