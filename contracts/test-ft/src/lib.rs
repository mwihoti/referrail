//! Minimal NEP-141 fungible token for the ReferRail testnet demo.
//!
//! This exists so the demo never depends on a third-party "fake USDT" account
//! that may move or disappear. It implements exactly the surface the escrow
//! contract and the web app need:
//!
//! * `ft_transfer` / `ft_transfer_call` with the 1-yoctoNEAR security deposit
//! * `ft_on_transfer` receiver callback and the `ft_resolve_transfer` refund of
//!   any unused amount (escrow returns 0 or the full amount)
//! * `storage_deposit` / `storage_balance_of` so recipients are registered
//! * `mint` for the owner, used by the seed script
//!
//! It is deliberately not a production token: no allowances, no NEP-145
//! accounting beyond a flat per-account deposit, no NEP-297 events.

use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    env, ext_contract, near, require, serde_json, AccountId, Gas, NearToken, PanicOnDefault,
    Promise, PromiseOrValue,
};

pub const STORAGE_DEPOSIT: u128 = 1_250_000_000_000_000_000_000; // 0.00125 NEAR
const GAS_FOR_ON_TRANSFER: Gas = Gas::from_tgas(30);
const GAS_FOR_RESOLVE: Gas = Gas::from_tgas(10);

#[ext_contract(ext_receiver)]
pub trait FtReceiver {
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128;
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct FtMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
    pub decimals: u8,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TestFt {
    owner: AccountId,
    name: String,
    symbol: String,
    decimals: u8,
    total_supply: u128,
    balances: LookupMap<AccountId, u128>,
    registered: LookupMap<AccountId, bool>,
}

#[near]
impl TestFt {
    #[init]
    pub fn new(owner: AccountId, name: String, symbol: String, decimals: u8, total_supply: U128) -> Self {
        let mut balances = LookupMap::new(b"b");
        balances.insert(owner.clone(), total_supply.0);
        let mut registered = LookupMap::new(b"r");
        registered.insert(owner.clone(), true);
        Self {
            owner,
            name,
            symbol,
            decimals,
            total_supply: total_supply.0,
            balances,
            registered,
        }
    }

    #[payable]
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        require!(
            env::predecessor_account_id() == self.owner,
            "only the owner can mint"
        );
        self.registered.insert(account_id.clone(), true);
        let current = self.balances.get(&account_id).copied().unwrap_or(0);
        self.balances.insert(account_id.clone(), current + amount.0);
        self.total_supply += amount.0;
        env::log_str(&format!("MINT account={} amount={}", account_id, amount.0));
    }

    // -- NEP-145 (simplified) --------------------------------------------

    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>) -> U128 {
        let account = account_id.unwrap_or_else(|| env::predecessor_account_id());
        require!(
            env::attached_deposit() >= NearToken::from_yoctonear(STORAGE_DEPOSIT),
            "attach at least 0.00125 NEAR for storage"
        );
        self.registered.insert(account.clone(), true);
        if self.balances.get(&account).is_none() {
            self.balances.insert(account, 0);
        }
        U128(STORAGE_DEPOSIT)
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<U128> {
        if self.registered.get(&account_id).copied().unwrap_or(false) {
            Some(U128(STORAGE_DEPOSIT))
        } else {
            None
        }
    }

    // -- NEP-141 ---------------------------------------------------------

    pub fn ft_metadata(&self) -> FtMetadata {
        FtMetadata {
            spec: "ft-1.0.0".to_string(),
            name: self.name.clone(),
            symbol: self.symbol.clone(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: self.decimals,
        }
    }

    pub fn ft_total_supply(&self) -> U128 {
        U128(self.total_supply)
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.balances.get(&account_id).copied().unwrap_or(0))
    }

    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.internal_transfer(&env::predecessor_account_id(), &receiver_id, amount.0);
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"nep141\",\"version\":\"1.0.0\",\"event\":\"ft_transfer\",\"data\":[{{\"old_owner_id\":\"{}\",\"new_owner_id\":\"{}\",\"amount\":\"{}\"{}}}]}}",
            env::predecessor_account_id(),
            receiver_id,
            amount.0,
            memo.map(|m| format!(",\"memo\":\"{}\"", m)).unwrap_or_default()
        ));
    }

    #[payable]
    pub fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> Promise {
        self.internal_transfer(&env::predecessor_account_id(), &receiver_id, amount.0);
        let sender = env::predecessor_account_id();
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"nep141\",\"version\":\"1.0.0\",\"event\":\"ft_transfer\",\"data\":[{{\"old_owner_id\":\"{}\",\"new_owner_id\":\"{}\",\"amount\":\"{}\"}}]}}",
            sender, receiver_id, amount.0
        ));
        let _ = memo;
        ext_receiver::ext(receiver_id.clone())
            .with_static_gas(GAS_FOR_ON_TRANSFER)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .ft_on_transfer(sender.clone(), amount, msg)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_RESOLVE)
                    .ft_resolve_transfer(receiver_id, sender, amount),
            )
    }

    /// Refunds the unused part of a `ft_transfer_call` to the sender.
    ///
    /// Per NEP-141, the receiver's `ft_on_transfer` returns the amount it did
    /// NOT use. If the receiver call failed, the whole amount is unused. The
    /// return value is the amount that was actually used (kept by the receiver).
    #[private]
    pub fn ft_resolve_transfer(
        &mut self,
        receiver_id: AccountId,
        sender_id: AccountId,
        amount: U128,
    ) -> U128 {
        let unused: u128 = match env::promise_result(0) {
            near_sdk::PromiseResult::Successful(value) => serde_json::from_slice::<U128>(&value)
                .map(|v| v.0.min(amount.0))
                .unwrap_or(amount.0),
            _ => amount.0,
        };
        let mut refunded = 0;
        if unused > 0 {
            let receiver_balance = self.balances.get(&receiver_id).copied().unwrap_or(0);
            refunded = unused.min(receiver_balance);
            if refunded > 0 {
                self.balances.insert(receiver_id, receiver_balance - refunded);
                let sender_balance = self.balances.get(&sender_id).copied().unwrap_or(0);
                self.balances.insert(sender_id, sender_balance + refunded);
            }
        }
        U128(amount.0 - refunded)
    }

    fn internal_transfer(&mut self, sender_id: &AccountId, receiver_id: &AccountId, amount: u128) {
        require!(
            env::attached_deposit() == NearToken::from_yoctonear(1),
            "require exactly 1 yoctoNEAR"
        );
        require!(
            self.registered.get(receiver_id).copied().unwrap_or(false),
            "receiver is not registered on this token"
        );
        let sender_balance = self.balances.get(sender_id).copied().unwrap_or(0);
        require!(sender_balance >= amount, "insufficient balance");
        self.balances.insert(sender_id.clone(), sender_balance - amount);
        let receiver_balance = self.balances.get(receiver_id).copied().unwrap_or(0);
        self.balances.insert(receiver_id.clone(), receiver_balance + amount);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn ctx(predecessor: &str, deposit: u128) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .predecessor_account_id(predecessor.parse().unwrap())
            .current_account_id("usdc.testnet".parse().unwrap())
            .attached_deposit(NearToken::from_yoctonear(deposit));
        builder
    }

    fn token() -> TestFt {
        testing_env!(ctx("owner.testnet", 0).build());
        TestFt::new(
            "owner.testnet".parse().unwrap(),
            "ReferRail Demo USDC".to_string(),
            "tUSDC".to_string(),
            6,
            U128(1_000_000_000),
        )
    }

    /// Simulates the token's own `ft_resolve_transfer` callback after the
    /// receiver's `ft_on_transfer` produced `result`, with `amount` already
    /// moved from owner to escrow.
    fn resolve_with(result: near_sdk::PromiseResult, amount: u128) -> (TestFt, U128) {
        let mut token = token();
        testing_env!(ctx("owner.testnet", STORAGE_DEPOSIT).build());
        token.storage_deposit(Some("escrow.testnet".parse().unwrap()));
        testing_env!(ctx("owner.testnet", 1).build());
        token.ft_transfer("escrow.testnet".parse().unwrap(), U128(amount), None);
        testing_env!(
            ctx("usdc.testnet", 0).build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![result]
        );
        let used = token.ft_resolve_transfer(
            "escrow.testnet".parse().unwrap(),
            "owner.testnet".parse().unwrap(),
            U128(amount),
        );
        (token, used)
    }

    #[test]
    fn resolve_keeps_funds_when_receiver_accepts() {
        let (token, used) = resolve_with(near_sdk::PromiseResult::Successful(b"\"0\"".to_vec()), 10_000_000);
        assert_eq!(used.0, 10_000_000);
        assert_eq!(token.ft_balance_of("escrow.testnet".parse().unwrap()).0, 10_000_000);
    }

    #[test]
    fn resolve_refunds_when_receiver_refuses() {
        let (token, used) =
            resolve_with(near_sdk::PromiseResult::Successful(b"\"10000000\"".to_vec()), 10_000_000);
        assert_eq!(used.0, 0);
        assert_eq!(token.ft_balance_of("escrow.testnet".parse().unwrap()).0, 0);
        assert_eq!(token.ft_balance_of("owner.testnet".parse().unwrap()).0, 1_000_000_000);
    }

    #[test]
    fn resolve_refunds_when_receiver_panics() {
        let (token, used) = resolve_with(near_sdk::PromiseResult::Failed, 10_000_000);
        assert_eq!(used.0, 0);
        assert_eq!(token.ft_balance_of("owner.testnet".parse().unwrap()).0, 1_000_000_000);
    }

    #[test]
    fn balances_and_transfer() {
        let mut token = token();
        testing_env!(ctx("owner.testnet", STORAGE_DEPOSIT).build());
        token.storage_deposit(Some("bob.testnet".parse().unwrap()));
        testing_env!(ctx("owner.testnet", 1).build());
        token.ft_transfer(
            "bob.testnet".parse().unwrap(),
            U128(250_000),
            Some("gift".to_string()),
        );
        assert_eq!(token.ft_balance_of("bob.testnet".parse().unwrap()).0, 250_000);
        assert_eq!(token.ft_balance_of("owner.testnet".parse().unwrap()).0, 1_000_000_000 - 250_000);
    }

    #[test]
    #[should_panic(expected = "require exactly 1 yoctoNEAR")]
    fn transfer_requires_one_yocto() {
        let mut token = token();
        testing_env!(ctx("owner.testnet", STORAGE_DEPOSIT).build());
        token.storage_deposit(Some("bob.testnet".parse().unwrap()));
        testing_env!(ctx("owner.testnet", 0).build());
        token.ft_transfer("bob.testnet".parse().unwrap(), U128(1), None);
    }

    #[test]
    #[should_panic(expected = "receiver is not registered on this token")]
    fn unregistered_receiver_rejected() {
        let mut token = token();
        testing_env!(ctx("owner.testnet", 1).build());
        token.ft_transfer("nobody.testnet".parse().unwrap(), U128(1), None);
    }

    #[test]
    fn mint_only_owner() {
        let mut token = token();
        testing_env!(ctx("attacker.testnet", 0).build());
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            token.mint("attacker.testnet".parse().unwrap(), U128(1_000));
        }));
        assert!(result.is_err());
    }
}
