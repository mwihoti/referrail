#!/usr/bin/env bash
# Deploy ReferRail + the demo NEP-141 token to NEAR testnet and initialise them.
#
# Prerequisites:
#   - rustup target add wasm32-unknown-unknown
#   - cargo-near    (cargo near --version)
#   - near-cli-rs   (near --version), with the deployer account's key in the
#                   legacy keychain (~/.near-credentials/testnet/<account>.json).
#
# Create a funded deployer account with the faucet:
#   near account create-account sponsor-by-faucet-service <id>.testnet \
#     autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
#
# Usage:
#   NEAR_ACCOUNT=referrail-dev.testnet ./scripts/deploy-testnet.sh
#
# Optional: NEAR_FT_ACCOUNT (default usdc.$NEAR_ACCOUNT), NEAR_TREASURY_ACCOUNT
# (default $NEAR_ACCOUNT), PROTOCOL_FEE_BPS (default 200), FT_DECIMALS (default 6),
# FT_ACCOUNT_FUNDING (NEAR sent to the new token sub-account, default 3).

set -euo pipefail

NEAR_ACCOUNT="${NEAR_ACCOUNT:-referrail-dev.testnet}"
NEAR_FT_ACCOUNT="${NEAR_FT_ACCOUNT:-usdc.${NEAR_ACCOUNT}}"
NEAR_TREASURY_ACCOUNT="${NEAR_TREASURY_ACCOUNT:-$NEAR_ACCOUNT}"
PROTOCOL_FEE_BPS="${PROTOCOL_FEE_BPS:-200}"
FT_DECIMALS="${FT_DECIMALS:-6}"
FT_ACCOUNT_FUNDING="${FT_ACCOUNT_FUNDING:-3}"
NETWORK="${NEAR_NETWORK:-testnet}"

if [[ "$NETWORK" != "testnet" ]]; then
  echo "Refusing to run: this script only deploys to testnet (NEAR_NETWORK=$NETWORK)." >&2
  exit 1
fi

for tool in near cargo; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing '$tool' on PATH (install near-cli-rs / rustup + cargo-near; they live in ~/.cargo/bin)." >&2
    exit 1
  fi
done
if ! cargo near --version >/dev/null 2>&1; then
  echo "Missing cargo-near (cargo near --version failed)." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NET=(network-config testnet)
SIGN=(sign-with-legacy-keychain send)

# Exit 0 if the account exists, 1 if the RPC says it does not, 2 on any other error.
account_exists() {
  local out
  if out="$(near account view-account-summary "$1" "${NET[@]}" now 2>&1)"; then
    return 0
  fi
  if grep -qiE "does not exist|UNKNOWN_ACCOUNT|AccountDoesNotExist" <<<"$out"; then
    return 1
  fi
  echo "Could not check account $1:" >&2
  echo "$out" | tail -5 >&2
  return 2
}

# True if <contract> answers the read-only <method>, i.e. it is deployed and initialised.
is_initialised() {
  near contract call-function as-read-only "$1" "$2" json-args '{}' "${NET[@]}" now >/dev/null 2>&1
}

# Deploy <wasm> to <account>; run `new <json>` only the first time (init panics
# on an initialised account and would revert the code upgrade with it).
deploy() {
  local account="$1" wasm="$2" probe="$3" init_args="$4"
  if is_initialised "$account" "$probe"; then
    echo "    $account is already initialised: upgrading code only"
    near contract deploy "$account" use-file "$wasm" without-init-call "${NET[@]}" "${SIGN[@]}"
  else
    near contract deploy "$account" use-file "$wasm" \
      with-init-call new json-args "$init_args" \
      prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \
      "${NET[@]}" "${SIGN[@]}"
  fi
}

# near contract call-function as-transaction <contract> <method> <json> <signer>
call() {
  near contract call-function as-transaction "$1" "$2" json-args "$3" \
    prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \
    sign-as "$4" "${NET[@]}" "${SIGN[@]}"
}

echo "==> building contracts (cargo near)"
( cd "$ROOT/contracts/referrail" && cargo near build non-reproducible-wasm )
( cd "$ROOT/contracts/test-ft" && cargo near build non-reproducible-wasm )

REFERRAIL_WASM="$ROOT/contracts/referrail/target/near/referrail.wasm"
FT_WASM="$ROOT/contracts/test-ft/target/near/referrail_test_ft.wasm"

for wasm in "$REFERRAIL_WASM" "$FT_WASM"; do
  if [[ ! -f "$wasm" ]]; then
    echo "Missing $wasm — the cargo near build step did not produce it." >&2
    exit 1
  fi
done

set +e
account_exists "$NEAR_ACCOUNT"
status=$?
set -e
if [[ $status -eq 1 ]]; then
  echo "Deployer account $NEAR_ACCOUNT does not exist on testnet. Create it with the faucet first." >&2
  exit 1
elif [[ $status -ne 0 ]]; then
  exit 1
fi

echo "==> deploying + initialising escrow on $NEAR_ACCOUNT (fee ${PROTOCOL_FEE_BPS} bps, treasury $NEAR_TREASURY_ACCOUNT)"
deploy "$NEAR_ACCOUNT" "$REFERRAIL_WASM" get_config \
  "{\"owner\":\"$NEAR_ACCOUNT\",\"treasury\":\"$NEAR_TREASURY_ACCOUNT\",\"protocol_fee_bps\":$PROTOCOL_FEE_BPS}"

echo "==> deploying demo NEP-141 token to $NEAR_FT_ACCOUNT"
ft_status=0
if [[ "$NEAR_FT_ACCOUNT" != "$NEAR_ACCOUNT" ]]; then
  set +e
  account_exists "$NEAR_FT_ACCOUNT"
  ft_status=$?
  set -e
  [[ $ft_status -eq 2 ]] && exit 1
fi
if [[ $ft_status -eq 1 ]]; then
  near account create-account fund-myself "$NEAR_FT_ACCOUNT" "$FT_ACCOUNT_FUNDING NEAR" \
    autogenerate-new-keypair save-to-legacy-keychain \
    sign-as "$NEAR_ACCOUNT" "${NET[@]}" "${SIGN[@]}"
fi
deploy "$NEAR_FT_ACCOUNT" "$FT_WASM" ft_metadata \
  "{\"owner\":\"$NEAR_ACCOUNT\",\"name\":\"ReferRail Demo USDC\",\"symbol\":\"tUSDC\",\"decimals\":$FT_DECIMALS,\"total_supply\":\"0\"}"

echo "==> whitelisting the demo token on escrow"
call "$NEAR_ACCOUNT" whitelist_token "{\"token\":\"$NEAR_FT_ACCOUNT\"}" "$NEAR_ACCOUNT"

echo
echo "Deployed:"
echo "  escrow:     $NEAR_ACCOUNT"
echo "  demo token: $NEAR_FT_ACCOUNT"
echo
echo "Next: fill apps/web/.env.local (see .env.example), then run: npm run seed -- --write-env"
