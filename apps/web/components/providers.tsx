"use client";

import { WalletProvider } from "@/components/wallet";

export function Providers({
  network,
  contractId,
  children,
}: {
  network: "testnet" | "mainnet";
  contractId: string;
  children: React.ReactNode;
}) {
  return (
    <WalletProvider network={network} contractId={contractId}>
      {children}
    </WalletProvider>
  );
}
