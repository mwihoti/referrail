import Link from "next/link";
import { explorerAccount } from "@/components/explorer";

const productLinks = [
  { href: "/", label: "Marketplace" },
  { href: "/business", label: "For businesses" },
  { href: "/creator", label: "For creators" },
  { href: "/intents", label: "Payouts" },
  { href: "/ledger", label: "Activity" },
];

export function Footer({ network, contractId }: { network: "testnet" | "mainnet"; contractId: string }) {
  const year = new Date().getFullYear();
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-grid">
          <div className="footer-brand">
            <Link href="/" className="brand" aria-label="ReferRail home">
              <span className="brand-mark" aria-hidden="true">
                RR
              </span>
              <span>ReferRail</span>
            </Link>
            <p>Referral sales that pay creators only when they sell, settled by an escrow contract on NEAR.</p>
          </div>
          <nav className="footer-col" aria-label="Product">
            <h2>Product</h2>
            <ul>
              {productLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="footer-col">
            <h2>Trust</h2>
            <ul>
              {contractId ? (
                <li>
                  <a href={explorerAccount(network, contractId)} target="_blank" rel="noreferrer">
                    Smart contract
                  </a>
                </li>
              ) : null}
              <li>
                <Link href="/ledger">Public activity</Link>
              </li>
              <li>
                <span>{network === "testnet" ? "Running on the NEAR test network" : "Running on NEAR mainnet"}</span>
              </li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {year} ReferRail</span>
          <span>Payments are escrowed and split on-chain.</span>
        </div>
      </div>
    </footer>
  );
}
