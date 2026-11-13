"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { WalletButton } from "@/components/wallet-button";

export const navLinks = [
  { href: "/", label: "Marketplace" },
  { href: "/business", label: "For businesses" },
  { href: "/creator", label: "For creators" },
  { href: "/intents", label: "Payouts" },
  { href: "/ledger", label: "Activity" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/offer");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Nav({ network }: { network: string }) {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const isMainnet = network === "mainnet";

  return (
    <header className="nav">
      <div className="nav-inner">
        <Link href="/" className="brand" aria-label="ReferRail home" onClick={() => setOpen(false)}>
          <span className="brand-mark" aria-hidden="true">
            RR
          </span>
          <span>ReferRail</span>
        </Link>
        <nav id="primary-nav" aria-label="Primary" className={`nav-links${open ? " open" : ""}`}>
          {navLinks.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`nav-link${active ? " active" : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="nav-end">
          <span
            className={`net-badge${isMainnet ? " net-badge-mainnet" : ""}`}
            title={isMainnet ? "Connected to NEAR mainnet" : "Connected to the NEAR test network"}
          >
            <span className="net-badge-label">{isMainnet ? "Mainnet" : "Test network"}</span>
          </span>
          <WalletButton />
          <button
            type="button"
            className="nav-toggle"
            aria-expanded={open}
            aria-controls="primary-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((value) => !value)}
          >
            <span className="nav-toggle-bars" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}
