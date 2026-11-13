import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Footer } from "@/components/footer";
import { Nav } from "@/components/nav";
import { NetworkBanner } from "@/components/network-banner";
import { Providers } from "@/components/providers";

const network = process.env.NEXT_PUBLIC_NEAR_NETWORK === "mainnet" ? "mainnet" : "testnet";
const contractId = process.env.NEXT_PUBLIC_NEAR_CONTRACT_ID ?? "";

function siteUrl(): URL | undefined {
  try {
    return process.env.NEXT_PUBLIC_APP_URL ? new URL(process.env.NEXT_PUBLIC_APP_URL) : undefined;
  } catch {
    return undefined;
  }
}

const description =
  "ReferRail lets businesses pay creators only when they sell. Each creator gets a unique referral link, buyer payments are held in escrow on NEAR, and every sale is split between merchant and creator when it is released after the refund window.";

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: {
    default: "ReferRail — pay creators only when they sell",
    template: "%s · ReferRail",
  },
  description,
  applicationName: "ReferRail",
  openGraph: {
    type: "website",
    siteName: "ReferRail",
    title: "ReferRail — pay creators only when they sell",
    description,
  },
  twitter: {
    card: "summary",
    title: "ReferRail — pay creators only when they sell",
    description,
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0d12",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <Providers network={network} contractId={contractId}>
          <NetworkBanner network={network} />
          <Nav network={network} />
          <main id="main" className="shell">
            {children}
          </main>
          <Footer network={network} contractId={contractId} />
        </Providers>
      </body>
    </html>
  );
}
