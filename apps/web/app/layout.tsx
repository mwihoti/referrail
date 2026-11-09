import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/nav";
import { Providers } from "@/components/providers";

const network = process.env.NEXT_PUBLIC_NEAR_NETWORK === "mainnet" ? "mainnet" : "testnet";
const contractId = process.env.NEXT_PUBLIC_NEAR_CONTRACT_ID ?? "";

export const metadata: Metadata = {
  title: "ReferRail NEAR — pay-on-sale referral splits",
  description:
    "A business publishes an offer, creators get unique links, buyers pay, and a NEAR contract splits the sale on delivery. Built at NEAR HACKATHON.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers network={network} contractId={contractId}>
          <Nav network={network} />
          <main className="shell">{children}</main>
          <footer className="footer">
            <span>
              ReferRail NEAR · built at NEAR HACKATHON · escrow + split on NEAR testnet, cross-chain
              quotes through NEAR Intents (mainnet, dry by default)
            </span>
            <a href="/api/health">/api/health</a>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
