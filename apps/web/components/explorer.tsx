export function explorerTx(network: string, hash: string | undefined): string {
  if (!hash) return "#";
  return network === "mainnet"
    ? `https://nearblocks.io/txns/${hash}`
    : `https://testnet.nearblocks.io/txns/${hash}`;
}

export function explorerAccount(network: string, account: string): string {
  return network === "mainnet"
    ? `https://nearblocks.io/address/${account}`
    : `https://testnet.nearblocks.io/address/${account}`;
}

export function TxLink({
  network,
  hash,
  label = "receipt",
}: {
  network: string;
  hash: string | undefined;
  label?: string;
}) {
  if (!hash) return <span className="muted small">—</span>;
  return (
    <a className="link small mono" href={explorerTx(network, hash)} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}
