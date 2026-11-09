#!/usr/bin/env bash
# Deploy ReferRail + the demo NEP-141 token to NEAR testnet and initialise them.
#
# Prerequisites:
#   - rustup target add wasm32-unknown-unknown
#   - cargo-near (cargo near --version)
#   - near-cli-rs with the deployer account signed in (`near login`)
#
# Usage:
#   NEAR_ACCOUNT=referrail-dev.testnet \
#   NEAR_FT_ACCOUNT=usdc.referrail-dev.testnet \
#   NEAR_TREASURY_ACCOUNT=referrail-dev.testnet \
#   ./scripts/deploy-testnet.sh
#
# The deployer account must exist and hold a few testnet NEAR (faucet:
# `near create-account <id>.testnet --useFaucet`).

set -euo pipefail

NEAR_ACCOUNT="${NEAR_ACCOUNT:-referrail-dev.testnet}"
NEAR_FT_ACCOUNT="${NEAR_FT_ACCOUNT:-usdc.${NEAR_ACCOUNT}}"
NEAR_TREASURY_ACCOUNT="${NEAR_TREASURY_ACCOUNT:-$NEAR_ACCOUNT}"
PROTOCOL_FEE_BPS="${PROTOCOL_FEE_BPS:-200}"
FT_DECIMALS="${FT_DECIMALS:-6}"
NETWORK="${NEAR_NETWORK:-testnet}"

if [[ "$NETWORK" != "testnet" ]]; then
  echo "Refusing to run: this script only deploys to testnet (NEAR_NETWORK=$NETWORK)." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> building contracts (cargo near)"
( cd "$ROOT/contracts/referrail" && cargo near build non-reproducible-wasm )
( cd "$ROOT/contracts/test-ft" && cargo near build non-reproducible-wasm )

REFERRAIL_WASM="$ROOT/contracts/referrail/target/near/referrail.wasm"
FT_WASM="$ROOT/contracts/test-ft/target/near/test_ft.wasm"

for wasm in "$REFERRAIL_WASM" "$FT_WASM"; do
  if [[ ! -f "$wasm" ]]; then
    echo "Missing $wasm — the cargo near build step did not produce it." >&2
    exit 1
  fi
done

echo "==> deploying escrow to $NEAR_ACCOUNT"
near deploy "$NEAR_ACCOUNT" "$REFERRAIL_WASM" --useAccount "$NEAR_ACCOUNT"

echo "==> initialising escrow (fee ${PROTOCOL_FEE_BPS} bps, treasury $NEAR_TREASURY_ACCOUNT)"
near call "$NEAR_ACCOUNT" new \
  "{\"owner\":\"$NEAR_ACCOUNT\",\"treasury\":\"$NEAR_TREASURY_ACCOUNT\",\"protocol_fee_bps\":$PROTOCOL_FEE_BPS}" \
  --useAccount "$NEAR_ACCOUNT"

echo "==> deploying demo NEP-141 token to $NEAR_FT_ACCOUNT"
if [[ "$NEAR_FT_ACCOUNT" != "$NEAR_ACCOUNT" ]]; then
  near create-account "$NEAR_FT_ACCOUNT" --useAccount "$NEAR_ACCOUNT" || true
fi
near deploy "$NEAR_FT_ACCOUNT" "$FT_WASM" --useAccount "$NEAR_ACCOUNT"
near call "$NEAR_FT_ACCOUNT" new \
  "{\"owner\":\"$NEAR_ACCOUNT\",\"name\":\"ReferRail Demo USDC\",\"symbol\":\"tUSDC\",\"decimals\":$FT_DECIMALS,\"total_supply\":\"0\"}" \
  --useAccount "$NEAR_ACCOUNT"

echo "==> whitelisting the demo token on escrow"
near call "$NEAR_ACCOUNT" whitelist_token "{\"token\":\"$NEAR_FT_ACCOUNT\"}" --useAccount "$NEAR_ACCOUNT"

echo
echo "Deployed:"
echo "  escrow:    $NEAR_ACCOUNT"
echo "  demo token $NEAR_FT_ACCOUNT"
echo
echo "Next: fill apps/web/.env.local (see .env.example), then run: npm run seed -- --write-env"
