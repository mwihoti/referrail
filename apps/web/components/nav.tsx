import Link from "next/link";

const links = [
  { href: "/", label: "Home" },
  { href: "/business", label: "Business" },
  { href: "/creator", label: "Creator" },
  { href: "/intents", label: "Intents" },
  { href: "/ledger", label: "Ledger" },
];

export function Nav({ network }: { network: string }) {
  return (
    <header className="nav">
      <Link href="/" className="brand">
        <span className="brand-mark">RR</span>
        <span>
          ReferRail <span className="muted">NEAR</span>
        </span>
      </Link>
      <nav className="nav-links">
        {links.map((link) => (
          <Link key={link.href} href={link.href}>
            {link.label}
          </Link>
        ))}
      </nav>
      <span className={`badge badge-${network === "mainnet" ? "warn" : "ok"}`}>{network}</span>
    </header>
  );
}
