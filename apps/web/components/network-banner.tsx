/** Slim site-wide notice shown only on the test network. */
export function NetworkBanner({ network }: { network: "testnet" | "mainnet" }) {
  if (network !== "testnet") return null;
  return (
    <div className="net-banner" role="note">
      <strong>Test network</strong> — payments use test tokens. No real money moves.
    </div>
  );
}
