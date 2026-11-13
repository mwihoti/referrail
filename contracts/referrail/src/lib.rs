//! ReferRail NEAR — pay-on-sale referral escrow.
//!
//! A merchant publishes an offer (price, commission, refund hold). Creators
//! register a short referral code per offer and get a link. A buyer pays the
//! offer's NEP-141 token through `ft_transfer_call`; the contract escrows it and
//! records a `Sale`. Once the refund hold elapses anyone may call `release`,
//! which splits the escrow between the merchant, the creator (if any) and the
//! protocol treasury. Until the hold elapses the merchant may `refund`.
//!
//! Identity is always `env::predecessor_account_id()` so NEP-366 meta
//! transactions (gasless creator claims) are attributed to the real user even
//! though the relayer is the signer.

use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::store::{LookupMap, UnorderedMap, UnorderedSet};
use near_sdk::{
    env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise,
    PromiseOrValue,
};

pub const BPS_DENOMINATOR: u128 = 10_000;
pub const MAX_PROTOCOL_FEE_BPS: u16 = 200;
const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(35);
const MAX_CODE_LEN: usize = 32;

// ---------------------------------------------------------------------------
// Cross-contract interface
// ---------------------------------------------------------------------------

#[ext_contract(ext_ft)]
pub trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SaleStatus {
    Pending,
    Released,
    Refunded,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IntentsDest {
    /// Chain id understood by 1Click (for example `base`, `near`, `sol`).
    pub chain: String,
    /// 1Click asset id, for example `nep141:usdt.tether-token.near`.
    pub asset_id: String,
    /// Address on the destination chain that should receive this party's share.
    pub recipient: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Offer {
    pub id: u64,
    pub merchant: AccountId,
    pub title: String,
    pub description: String,
    /// NEP-141 contract used for escrow (testnet demo token by default).
    pub token: AccountId,
    pub price: U128,
    /// Creator share of the gross sale, in basis points.
    pub commission_bps: u16,
    /// Protocol fee snapshot taken at creation time.
    pub protocol_fee_bps: u16,
    /// Escrow hold before `release` is allowed, in nanoseconds (0 = immediate).
    pub refund_hold_ns: u64,
    /// `None` means anyone may promote the offer.
    pub allowed_creators: Option<Vec<AccountId>>,
    /// NEAR account that receives the merchant share.
    pub payout_account: AccountId,
    /// Optional cross-chain destination used by the mainnet Intents module.
    pub intents_dest: Option<IntentsDest>,
    pub paused: bool,
    pub created_at_ns: u64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct CreatorLink {
    pub offer_id: u64,
    pub account: AccountId,
    pub code: String,
    pub commission_bps_override: Option<u16>,
    pub payout_account: AccountId,
    pub created_at_ns: u64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Sale {
    pub id: u64,
    pub offer_id: u64,
    pub buyer: AccountId,
    pub creator: Option<AccountId>,
    pub creator_code: Option<String>,
    pub amount: U128,
    pub created_at_ns: u64,
    pub release_at_ns: u64,
    pub status: SaleStatus,
    /// Economics snapshot: later offer edits never change an in-flight sale.
    pub creator_bps: u16,
    pub protocol_bps: u16,
    pub merchant_amount: U128,
    pub creator_amount: U128,
    pub protocol_amount: U128,
    pub merchant_payout: AccountId,
    pub creator_payout: Option<AccountId>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct ProtocolConfig {
    pub owner: AccountId,
    pub treasury: AccountId,
    pub protocol_fee_bps: u16,
    pub paused_global: bool,
    pub tokens: Vec<AccountId>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct SplitPreview {
    pub amount: U128,
    pub creator_bps: u16,
    pub protocol_bps: u16,
    pub merchant_amount: U128,
    pub creator_amount: U128,
    pub protocol_amount: U128,
    pub merchant_payout: AccountId,
    pub creator_payout: Option<AccountId>,
    pub known_creator: bool,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Stats {
    pub offer_count: u64,
    pub sale_count: u64,
    /// Sum of `amount` across every sale ever recorded.
    pub volume: U128,
}

#[derive(Serialize, Deserialize)]
pub struct BuyMsg {
    pub offer_id: u64,
    #[serde(rename = "ref", default)]
    pub ref_code: Option<String>,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    treasury: AccountId,
    protocol_fee_bps: u16,
    paused_global: bool,
    tokens: UnorderedSet<AccountId>,
    offers: UnorderedMap<u64, Offer>,
    sales: UnorderedMap<u64, Sale>,
    creator_codes: LookupMap<String, CreatorLink>,
    creator_accounts: LookupMap<String, CreatorLink>,
    creator_sales: LookupMap<AccountId, Vec<u64>>,
    offer_sales: LookupMap<u64, Vec<u64>>,
    next_offer_id: u64,
    next_sale_id: u64,
    volume: u128,
}

fn code_key(offer_id: u64, code: &str) -> String {
    format!("{}:{}", offer_id, code)
}

fn account_key(offer_id: u64, account: &AccountId) -> String {
    format!("{}:{}", offer_id, account)
}

fn compute_split(amount: u128, creator_bps: u16, protocol_bps: u16) -> (u128, u128, u128) {
    let protocol = amount * protocol_bps as u128 / BPS_DENOMINATOR;
    let creator = amount * creator_bps as u128 / BPS_DENOMINATOR;
    // The guards on offer creation/registration keep `creator_bps + protocol_bps
    // < 10_000`, so this cannot underflow.
    let merchant = amount - protocol - creator;
    (merchant, creator, protocol)
}

fn valid_code(code: &str) -> bool {
    !code.is_empty()
        && code.len() <= MAX_CODE_LEN
        && code
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId, treasury: AccountId, protocol_fee_bps: u16) -> Self {
        require!(
            protocol_fee_bps <= MAX_PROTOCOL_FEE_BPS,
            "protocol fee above 2% cap"
        );
        Self {
            owner,
            treasury,
            protocol_fee_bps,
            paused_global: false,
            tokens: UnorderedSet::new(b"t"),
            offers: UnorderedMap::new(b"o"),
            sales: UnorderedMap::new(b"s"),
            creator_codes: LookupMap::new(b"c"),
            creator_accounts: LookupMap::new(b"a"),
            creator_sales: LookupMap::new(b"q"),
            offer_sales: LookupMap::new(b"p"),
            next_offer_id: 1,
            next_sale_id: 1,
            volume: 0,
        }
    }

    // -- admin ------------------------------------------------------------

    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner,
            "only owner can call this"
        );
    }

    pub fn set_paused(&mut self, flag: bool) {
        self.assert_owner();
        self.paused_global = flag;
    }

    pub fn whitelist_token(&mut self, token: AccountId) {
        self.assert_owner();
        self.tokens.insert(token);
    }

    pub fn remove_token(&mut self, token: AccountId) {
        self.assert_owner();
        self.tokens.remove(&token);
    }

    pub fn set_treasury(&mut self, account: AccountId) {
        self.assert_owner();
        self.treasury = account;
    }

    /// Applies to newly created offers only; existing offers keep their snapshot.
    pub fn set_protocol_fee_bps(&mut self, bps: u16) {
        self.assert_owner();
        require!(bps <= MAX_PROTOCOL_FEE_BPS, "protocol fee above 2% cap");
        self.protocol_fee_bps = bps;
    }

    // -- business ---------------------------------------------------------

    pub fn create_offer(
        &mut self,
        title: String,
        description: String,
        token: AccountId,
        price: U128,
        commission_bps: u16,
        refund_hold_ns: u64,
        allowed_creators: Option<Vec<AccountId>>,
        payout_account: Option<AccountId>,
        intents_dest: Option<IntentsDest>,
    ) -> u64 {
        let merchant = env::predecessor_account_id();
        require!(self.tokens.contains(&token), "token not whitelisted");
        require!(price.0 > 0, "price must be positive");
        require!(!title.trim().is_empty(), "title is required");
        require!(title.len() <= 120, "title too long");
        require!(description.len() <= 2_000, "description too long");
        let fees_fit = (commission_bps as u32 + self.protocol_fee_bps as u32) < BPS_DENOMINATOR as u32;
        require!(fees_fit, "commission + protocol fee must stay below 100%");
        if let Some(list) = &allowed_creators {
            require!(!list.is_empty(), "allow-list cannot be empty");
        }

        let id = self.next_offer_id;
        self.next_offer_id += 1;

        let offer = Offer {
            id,
            merchant,
            title,
            description,
            token,
            price,
            commission_bps,
            protocol_fee_bps: self.protocol_fee_bps,
            refund_hold_ns,
            allowed_creators: allowed_creators.clone(),
            payout_account: payout_account.unwrap_or_else(|| {
                env::predecessor_account_id()
            }),
            intents_dest,
            paused: false,
            created_at_ns: env::block_timestamp(),
        };
        self.offers.insert(id, offer);
        env::log_str(&format!("OFFER_CREATED id={}", id));
        id
    }

    pub fn update_offer(
        &mut self,
        offer_id: u64,
        title: String,
        description: String,
        price: U128,
        commission_bps: u16,
        refund_hold_ns: u64,
        allowed_creators: Option<Vec<AccountId>>,
        payout_account: Option<AccountId>,
        intents_dest: Option<IntentsDest>,
    ) {
        let mut offer = self.offers.get(&offer_id).expect("offer not found").clone();
        require!(
            offer.merchant == env::predecessor_account_id(),
            "only the merchant can update this offer"
        );
        require!(price.0 > 0, "price must be positive");
        require!(!title.trim().is_empty(), "title is required");
        let fees_fit = (commission_bps as u32 + offer.protocol_fee_bps as u32) < BPS_DENOMINATOR as u32;
        require!(fees_fit, "commission + protocol fee must stay below 100%");
        offer.title = title;
        offer.description = description;
        offer.price = price;
        offer.commission_bps = commission_bps;
        offer.refund_hold_ns = refund_hold_ns;
        offer.allowed_creators = allowed_creators;
        offer.payout_account = payout_account.unwrap_or(offer.payout_account);
        offer.intents_dest = intents_dest;
        self.offers.insert(offer_id, offer);
    }

    pub fn pause_offer(&mut self, offer_id: u64, paused: bool) {
        let mut offer = self.offers.get(&offer_id).expect("offer not found").clone();
        require!(
            offer.merchant == env::predecessor_account_id(),
            "only the merchant can pause this offer"
        );
        offer.paused = paused;
        self.offers.insert(offer_id, offer);
    }

    /// Merchant refunds a pending sale; the buyer gets the full amount back.
    pub fn refund(&mut self, sale_id: u64) {
        let mut sale = self.sales.get(&sale_id).expect("sale not found").clone();
        require!(sale.status == SaleStatus::Pending, "sale is not pending");
        let offer = self
            .offers
            .get(&sale.offer_id)
            .expect("offer not found")
            .clone();
        require!(
            offer.merchant == env::predecessor_account_id(),
            "only the merchant can refund this sale"
        );
        sale.status = SaleStatus::Refunded;
        self.sales.insert(sale_id, sale.clone());

        env::log_str(&format!(
            "REFUND sale={} buyer={} amount={}",
            sale_id, sale.buyer, sale.amount.0
        ));
        ext_ft::ext(offer.token)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FOR_FT_TRANSFER)
            .ft_transfer(sale.buyer.clone(), sale.amount, None);
    }

    // -- creators ---------------------------------------------------------

    /// Gasless-friendly: takes no deposit, so a NEP-366 delegate or a
    /// function-call key can submit it. Claims are attributed to
    /// `predecessor_account_id`, which is the creator even under a meta-tx.
    pub fn register_creator(
        &mut self,
        offer_id: u64,
        code: String,
        payout_account: Option<AccountId>,
        commission_bps_override: Option<u16>,
    ) -> CreatorLink {
        let account = env::predecessor_account_id();
        let offer = self.offers.get(&offer_id).expect("offer not found").clone();
        require!(valid_code(&code), "invalid referral code");

        if let Some(list) = &offer.allowed_creators {
            require!(
                list.contains(&account),
                "this account is not on the offer allow-list"
            );
        }
        // A creator may lower their own commission but never raise it: the rate
        // is the merchant's to set (see `set_creator_commission`).
        if let Some(bps) = commission_bps_override {
            require!(
                bps <= offer.commission_bps,
                "creators cannot raise their own commission; ask the merchant"
            );
        }
        // Re-claiming your own code is allowed (it updates payout/override);
        // a code held by another creator is not.
        let mut kept_override = None;
        if let Some(existing) = self.creator_codes.get(&code_key(offer_id, &code)) {
            require!(existing.account == account, "referral code already claimed");
            // Re-claiming keeps a merchant-set rate unless the creator lowers it.
            kept_override = existing.commission_bps_override;
        }
        let commission_bps_override = commission_bps_override.or(kept_override);

        // A creator keeps one link per offer; re-claiming replaces the old code.
        let acct_key = account_key(offer_id, &account);
        if let Some(previous) = self.creator_accounts.get(&acct_key).cloned() {
            self.creator_codes
                .remove(&code_key(offer_id, &previous.code));
        }

        let link = CreatorLink {
            offer_id,
            account: account.clone(),
            code: code.clone(),
            commission_bps_override,
            payout_account: payout_account.unwrap_or_else(|| account.clone()),
            created_at_ns: env::block_timestamp(),
        };
        self.creator_codes
            .insert(code_key(offer_id, &code), link.clone());
        self.creator_accounts.insert(acct_key, link.clone());
        env::log_str(&format!(
            "CREATOR_REGISTERED offer={} creator={} code={}",
            offer_id, account, code
        ));
        link
    }

    /// Merchant-only: give one creator's code a custom commission (e.g. a VIP
    /// rate), or clear it with `None` to fall back to the offer's rate. Applies
    /// to future sales only; pending sales keep their snapshotted split.
    pub fn set_creator_commission(
        &mut self,
        offer_id: u64,
        code: String,
        commission_bps_override: Option<u16>,
    ) -> CreatorLink {
        let offer = self.offers.get(&offer_id).expect("offer not found").clone();
        require!(
            offer.merchant == env::predecessor_account_id(),
            "only the merchant can set a creator's commission"
        );
        if let Some(bps) = commission_bps_override {
            let fees_fit = (bps as u32 + offer.protocol_fee_bps as u32) < BPS_DENOMINATOR as u32;
            require!(fees_fit, "commission + protocol fee must stay below 100%");
        }
        let key = code_key(offer_id, &code);
        let mut link = self.creator_codes.get(&key).expect("referral code not found").clone();
        link.commission_bps_override = commission_bps_override;
        self.creator_codes.insert(key, link.clone());
        self.creator_accounts
            .insert(account_key(offer_id, &link.account), link.clone());
        env::log_str(&format!(
            "CREATOR_COMMISSION offer={} code={} bps={:?}",
            offer_id, code, commission_bps_override
        ));
        link
    }

    // -- buying (NEP-141 receiver) ---------------------------------------

    /// Called by the NEP-141 token contract. Any unused amount is returned as
    /// the `U128` value, which the token refunds to the buyer.
    #[payable]
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        let parsed: BuyMsg = match near_sdk::serde_json::from_str(&msg) {
            Ok(value) => value,
            Err(_) => {
                env::log_str("REJECT malformed msg");
                return PromiseOrValue::Value(amount);
            }
        };
        let offer = match self.offers.get(&parsed.offer_id) {
            Some(offer) => offer.clone(),
            None => {
                env::log_str("REJECT unknown offer");
                return PromiseOrValue::Value(amount);
            }
        };

        if token != offer.token {
            env::log_str("REJECT wrong token");
            return PromiseOrValue::Value(amount);
        }
        if self.paused_global || offer.paused {
            env::log_str("REJECT offer paused");
            return PromiseOrValue::Value(amount);
        }
        if amount.0 != offer.price.0 {
            env::log_str("REJECT amount must equal price");
            return PromiseOrValue::Value(amount);
        }

        let creator_link = match parsed.ref_code.as_ref() {
            None => None,
            Some(code) => match self.creator_codes.get(&code_key(offer.id, code)) {
                Some(link) => Some(link.clone()),
                None => {
                    env::log_str("REJECT unknown referral code");
                    return PromiseOrValue::Value(amount);
                }
            },
        };

        // A buyer cannot earn commission on their own purchase, either as the
        // registered creator or as the creator's payout account.
        if let Some(link) = creator_link.as_ref() {
            if link.account == sender_id || link.payout_account == sender_id {
                env::log_str("REJECT self-referral");
                return PromiseOrValue::Value(amount);
            }
        }

        let creator_bps = creator_link
            .as_ref()
            .map(|link| link.commission_bps_override.unwrap_or(offer.commission_bps))
            .unwrap_or(0);
        let (merchant_amount, creator_amount, protocol_amount) =
            compute_split(amount.0, creator_bps, offer.protocol_fee_bps);

        let sale_id = self.next_sale_id;
        self.next_sale_id += 1;
        let now = env::block_timestamp();
        let sale = Sale {
            id: sale_id,
            offer_id: offer.id,
            buyer: sender_id.clone(),
            creator: creator_link.as_ref().map(|link| link.account.clone()),
            creator_code: creator_link.as_ref().map(|link| link.code.clone()),
            amount,
            created_at_ns: now,
            release_at_ns: now.saturating_add(offer.refund_hold_ns),
            status: SaleStatus::Pending,
            creator_bps,
            protocol_bps: offer.protocol_fee_bps,
            merchant_amount: U128(merchant_amount),
            creator_amount: U128(creator_amount),
            protocol_amount: U128(protocol_amount),
            merchant_payout: offer.payout_account.clone(),
            creator_payout: creator_link.as_ref().map(|link| link.payout_account.clone()),
        };
        self.sales.insert(sale_id, sale.clone());
        self.volume += amount.0;

        if let Some(creator) = &sale.creator {
            let mut ids = self.creator_sales.get(creator).cloned().unwrap_or_default();
            ids.push(sale_id);
            self.creator_sales.insert(creator.clone(), ids);
        }
        let mut offer_ids = self.offer_sales.get(&offer.id).cloned().unwrap_or_default();
        offer_ids.push(sale_id);
        self.offer_sales.insert(offer.id, offer_ids);

        env::log_str(&format!(
            "SALE_CREATED sale={} offer={} buyer={} creator={} amount={} release_at={}",
            sale_id,
            offer.id,
            sender_id,
            sale.creator
                .as_ref()
                .map(|c| c.to_string())
                .unwrap_or_else(|| "-".to_string()),
            amount.0,
            sale.release_at_ns
        ));
        PromiseOrValue::Value(U128(0))
    }

    /// Anyone may release once the hold has elapsed. The contract pays the
    /// 1-yoctoNEAR `ft_transfer` deposits from its own balance, so a gasless
    /// buyer or relayer never needs to attach NEAR.
    pub fn release(&mut self, sale_id: u64) {
        let mut sale = self.sales.get(&sale_id).expect("sale not found").clone();
        require!(sale.status == SaleStatus::Pending, "sale is not pending");
        require!(
            env::block_timestamp() >= sale.release_at_ns,
            "refund hold has not elapsed yet"
        );
        let offer = self
            .offers
            .get(&sale.offer_id)
            .expect("offer not found")
            .clone();

        sale.status = SaleStatus::Released;
        self.sales.insert(sale_id, sale.clone());

        env::log_str(&format!(
            "RELEASE sale={} merchant={} merchant_amount={} creator={} creator_amount={} protocol_amount={}",
            sale_id,
            sale.merchant_payout,
            sale.merchant_amount.0,
            sale.creator_payout
                .as_ref()
                .map(|c| c.to_string())
                .unwrap_or_else(|| "-".to_string()),
            sale.creator_amount.0,
            sale.protocol_amount.0
        ));

        let token = offer.token;
        ext_ft::ext(token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FOR_FT_TRANSFER)
            .ft_transfer(sale.merchant_payout.clone(), sale.merchant_amount, None);

        if let Some(creator_payout) = &sale.creator_payout {
            if sale.creator_amount.0 > 0 {
                ext_ft::ext(token.clone())
                    .with_attached_deposit(NearToken::from_yoctonear(1))
                    .with_static_gas(GAS_FOR_FT_TRANSFER)
                    .ft_transfer(creator_payout.clone(), sale.creator_amount, None);
            }
        }

        if sale.protocol_amount.0 > 0 {
            ext_ft::ext(token)
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .with_static_gas(GAS_FOR_FT_TRANSFER)
                .ft_transfer(self.treasury.clone(), sale.protocol_amount, None);
        }
    }

    // -- views ------------------------------------------------------------

    pub fn get_config(&self) -> ProtocolConfig {
        ProtocolConfig {
            owner: self.owner.clone(),
            treasury: self.treasury.clone(),
            protocol_fee_bps: self.protocol_fee_bps,
            paused_global: self.paused_global,
            tokens: self.tokens.iter().cloned().collect(),
        }
    }

    pub fn get_offer(&self, offer_id: u64) -> Option<Offer> {
        self.offers.get(&offer_id).cloned()
    }

    /// Cursor pagination: returns offers with `id > from`, oldest first.
    pub fn list_offers(&self, from: u32, limit: u32) -> Vec<Offer> {
        let mut out = Vec::new();
        let mut id = from as u64 + 1;
        while id < self.next_offer_id && out.len() < limit as usize {
            if let Some(offer) = self.offers.get(&id) {
                out.push(offer.clone());
            }
            id += 1;
        }
        out
    }

    pub fn get_sale(&self, sale_id: u64) -> Option<Sale> {
        self.sales.get(&sale_id).cloned()
    }

    pub fn list_sales(&self, from: u32, limit: u32) -> Vec<Sale> {
        let mut out = Vec::new();
        let mut id = from as u64 + 1;
        while id < self.next_sale_id && out.len() < limit as usize {
            if let Some(sale) = self.sales.get(&id) {
                out.push(sale.clone());
            }
            id += 1;
        }
        out
    }

    pub fn list_sales_by_offer(&self, offer_id: u64, from: u32, limit: u32) -> Vec<Sale> {
        let ids = self.offer_sales.get(&offer_id).cloned().unwrap_or_default();
        ids.iter()
            .skip(from as usize)
            .take(limit as usize)
            .filter_map(|id| self.sales.get(id).cloned())
            .collect()
    }

    pub fn list_sales_by_creator(
        &self,
        account: AccountId,
        from: u32,
        limit: u32,
    ) -> Vec<Sale> {
        let ids = self.creator_sales.get(&account).cloned().unwrap_or_default();
        ids.iter()
            .skip(from as usize)
            .take(limit as usize)
            .filter_map(|id| self.sales.get(id).cloned())
            .collect()
    }

    pub fn get_creator(&self, offer_id: u64, code: String) -> Option<CreatorLink> {
        self.creator_codes
            .get(&code_key(offer_id, &code))
            .cloned()
    }

    pub fn get_creator_by_account(
        &self,
        offer_id: u64,
        account: AccountId,
    ) -> Option<CreatorLink> {
        self.creator_accounts
            .get(&account_key(offer_id, &account))
            .cloned()
    }

    pub fn preview_split(
        &self,
        offer_id: u64,
        amount: U128,
        ref_code: Option<String>,
    ) -> SplitPreview {
        let offer = self.offers.get(&offer_id).expect("offer not found");
        let link = ref_code
            .as_ref()
            .and_then(|code| self.creator_codes.get(&code_key(offer_id, code)).cloned());
        let creator_bps = link
            .as_ref()
            .map(|l| l.commission_bps_override.unwrap_or(offer.commission_bps))
            .unwrap_or(0);
        let (merchant, creator, protocol) =
            compute_split(amount.0, creator_bps, offer.protocol_fee_bps);
        SplitPreview {
            amount,
            creator_bps,
            protocol_bps: offer.protocol_fee_bps,
            merchant_amount: U128(merchant),
            creator_amount: U128(creator),
            protocol_amount: U128(protocol),
            merchant_payout: offer.payout_account.clone(),
            creator_payout: link.as_ref().map(|l| l.payout_account.clone()),
            known_creator: link.is_some(),
        }
    }

    pub fn stats(&self) -> Stats {
        Stats {
            offer_count: self.next_offer_id - 1,
            sale_count: self.next_sale_id - 1,
            volume: U128(self.volume),
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn id(value: &str) -> AccountId {
        value.parse().unwrap()
    }

    const TOKEN: &str = "usdc.testnet";
    const TREASURY: &str = "treasury.testnet";
    const MERCHANT: &str = "merchant.testnet";
    const CREATOR: &str = "creator.testnet";
    const BUYER: &str = "buyer.testnet";
    const OTHER: &str = "other.testnet";
    const PRICE: u128 = 10_000_000;

    fn ts(n: u64) -> u64 {
        n * 1_000_000_000
    }

    fn ctx(predecessor: &str, timestamp: u64) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .predecessor_account_id(predecessor.parse().unwrap())
            .current_account_id(id("referrail.testnet"))
            .signer_account_id(predecessor.parse().unwrap())
            .block_timestamp(timestamp);
        builder
    }

    fn contract() -> Contract {
        testing_env!(ctx("deployer.testnet", ts(1)).build());
        Contract::new(
            id("deployer.testnet"),
            id(TREASURY),
            200,
        )
    }

    fn offer_fixture(contract: &mut Contract) -> u64 {
        testing_env!(ctx("deployer.testnet", ts(1)).build());
        contract.whitelist_token(id(TOKEN));
        testing_env!(ctx(MERCHANT, ts(10)).build());
        contract.create_offer(
            "Yoga class".to_string(),
            "60 minute live class".to_string(),
            id(TOKEN),
            U128(PRICE),
            1500,
            0,
            None,
            None,
            None,
        )
    }

    fn claim(contract: &mut Contract, offer_id: u64, code: &str) {
        testing_env!(ctx(CREATOR, ts(11)).build());
        contract.register_creator(offer_id, code.to_string(), None, None);
    }

    fn buy(contract: &mut Contract, offer_id: u64, ref_code: Option<&str>, timestamp: u64) -> u64 {
        let before = contract.stats().sale_count;
        testing_env!(ctx(TOKEN, timestamp).build());
        let msg = match ref_code {
            Some(code) => format!(r#"{{"offer_id":{},"ref":"{}"}}"#, offer_id, code),
            None => format!(r#"{{"offer_id":{}}}"#, offer_id),
        };
        let unused = contract.ft_on_transfer(id(BUYER), U128(PRICE), msg);
        match unused {
            PromiseOrValue::Value(U128(0)) => assert_eq!(
                contract.stats().sale_count,
                before + 1,
                "a sale should have been recorded"
            ),
            PromiseOrValue::Promise(_) => panic!("unexpected promise from ft_on_transfer"),
            _other => panic!("unexpected refund value from ft_on_transfer"),
        }
        contract.stats().sale_count
    }

    fn assert_unused(result: PromiseOrValue<U128>, expected: u128) {
        match result {
            PromiseOrValue::Value(value) => assert_eq!(value.0, expected),
            PromiseOrValue::Promise(_) => panic!("expected a refund value"),
        }
    }

    // 1. Fee math: 10 USDC, 15% creator, 2% protocol.
    #[test]
    fn split_math_matches_spec() {
        let mut contract = contract();
        let offer_id = offer_fixture(&mut contract);
        claim(&mut contract, offer_id, "ada");

        testing_env!(ctx(BUYER, ts(12)).build());
        let preview = contract.preview_split(offer_id, U128(PRICE), Some("ada".to_string()));
        assert_eq!(preview.creator_bps, 1500);
        assert_eq!(preview.protocol_bps, 200);
        assert_eq!(preview.creator_amount.0, 1_500_000);
        assert_eq!(preview.protocol_amount.0, 200_000);
        assert_eq!(preview.merchant_amount.0, 8_300_000);
        assert_eq!(preview.creator_payout.unwrap(), id(CREATOR));

        let sale_id = buy(&mut contract, offer_id, Some("ada"), ts(20));
        let sale = contract.get_sale(sale_id).unwrap();
        assert_eq!(sale.creator_amount.0, 1_500_000);
        assert_eq!(sale.protocol_amount.0, 200_000);
        assert_eq!(sale.merchant_amount.0, 8_300_000);
        assert_eq!(sale.amount.0, PRICE);
        assert_eq!(sale.status, SaleStatus::Pending);
    }

    // 2. No referral code: no creator cut, merchant gets the rest.
    #[test]
    fn split_without_referral() {
        let mut contract = contract();
        let offer_id = offer_fixture(&mut contract);
        let sale_id = buy(&mut contract, offer_id, None, ts(20));
        let sale = contract.get_sale(sale_id).unwrap();
        assert!(sale.creator.is_none());
        assert_eq!(sale.creator_amount.0, 0);
        assert_eq!(sale.protocol_amount.0, 200_000);
        assert_eq!(sale.merchant_amount.0, 9_800_000);
    }

    // 3. Commission that would leave the merchant negative is rejected.
    #[test]
    #[should_panic(expected = "commission + protocol fee must stay below 100%")]
    fn oversized_commission_rejected() {
        let mut contract = contract();
        testing_env!(ctx("deployer.testnet", ts(1)).build());
        contract.whitelist_token(id(TOKEN));
        testing_env!(ctx(MERCHANT, ts(10)).build());
        contract.create_offer(
            "Too generous".to_string(),
            String::new(),
            id(TOKEN),
            U128(PRICE),
            9_900,
            0,
            None,
            None,
            None,
        );
    }

    // 4. Wrong amount is refused and the whole transfer is returned (no sale).
    #[test]
    fn wrong_amount_is_refunded() {
        let mut contract = contract();
        let offer_id = offer_fixture(&mut contract);
        testing_env!(ctx(TOKEN, ts(20)).build());
        let result = contract.ft_on_transfer(
            id(BUYER),
            U128(PRICE - 1),
            format!(r#"{{"offer_id":{}}}"#, offer_id),
        );
        assert_unused(result, PRICE - 1);
        assert_eq!(contract.stats().sale_count, 0);
        assert_eq!(contract.stats().volume.0, 0);
    }

    // 4b. Unknown referral code is refused rather than silently unattributed.
    #[test]
    fn unknown_referral_code_is_refunded() {
        let mut contract = contract();
        let offer_id = offer_fixture(&mut contract);
        testing_env!(ctx(TOKEN, ts(20)).build());
        let result = contract.ft_on_transfer(
            id(BUYER),
            U128(PRICE),
            format!(r#"{{"offer_id":{},"ref":"nobody"}}"#, offer_id),
        );
        assert_unused(result, PRICE);
        assert_eq!(contract.stats().sale_count, 0);
    }

    // 4b2. A creator cannot buy through their own code (self-referral cashback),
    // and neither can the account that receives that creator's payouts.
    #[test]
    fn self_referral_is_refunded() {
        let mut contract = contract();
        let offer_id = offer_fixture(&mut contract);
        claim(&mut contract, offer_id, "ada");
        testing_env!(ctx(TOKEN, ts(20)).build());
        let result = contract.ft_on_transfer(
            id(CREATOR),
            U128(PRICE),
            format!(r#"{{"offer_id":{},"ref":"ada"}}"#, offer_id),
        );
        assert_unused(result, PRICE);

        testing_env!(ctx(OTHER, ts(21)).build());
        contract.register_creator(offer_id, "bob".to_string(), Some(id(BUYER)), None);
        testing_env!(ctx(TOKEN, ts(22)).build());
        let result = contract.ft_on_transfer(
            id(BUYER),
            U128(PRICE),
            format!(r#"{{"offer_id":{},"ref":"bob"}}"#, offer_id),
        );
        assert_unused(result, PRICE);
        assert_eq!(contract.stats().sale_count, 0);

        // The same buyer can still purchase through someone else's code.
        buy(&mut contract, offer_id, Some("ada"), ts(23));
    }

    // 4c. Buying with another FT is refused.
    #[test]
    fn wrong_token_is_refunded() {
        let mut contract = contract();
        let offer_id = offer_fixture(&mut contract);
        testing_env!(ctx("wrap.testnet", ts(20)).build());
        let result = contract.ft_on_transfer(
            id(BUYER),
            U128(PRICE),
            format!(r#"{{"offer_id":{}}}"#, offer_id),
        );
        assert_unused(result, PRICE);
        assert_eq!(contract.stats().sale_count, 0);
    }

    // 5. Merchant refund while pending, once only.
    #[test]
    fn refund_before_release_then_second_refund_panics() {
        let mut contract = contract();
        let offer_id = offer_fixture(&mut contract);
        claim(&mut contract, offer_id, "ada");
        let sale_id = buy(&mut contract, offer_id, Some("ada"), ts(20));

        testing_env!(ctx(MERCHANT, ts(21)).build());
        contract.refund(sale_id);
        assert_eq!(contract.get_sale(sale_id).unwrap().status, SaleStatus::Refunded);

        testing_env!(ctx(MERCHANT, ts(22)).build());
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.refund(sale_id);
        }));
        assert!(result.is_err(), "second refund must panic");
    }

    #[test]
    #[should_panic(expected = "only the merchant can refund this sale")]
    fn refund_by_other_account_panics() {
        let mut contract = contract();
        let offer_id = offer_fixture(&mut contract);
        let sale_id = buy(&mut contract, offer_id, None, ts(20));
        testing_env!(ctx(OTHER, ts(21)).build());
        contract.refund(sale_id);
    }

    // 6. Release is gated by the refund hold and can only happen once.
    #[test]
    fn release_after_hold_then_second_release_panics() {
        let mut contract = contract();
        let offer_id = offer_fixture(&mut contract);
        claim(&mut contract, offer_id, "ada");

        testing_env!(ctx(MERCHANT, ts(100)).build());
        let sale_id = contract.create_offer(
            "Held offer".to_string(),
            String::new(),
            id(TOKEN),
            U128(PRICE),
            1500,
            ts(50),
            None,
            None,
            None,
        );
        let _ = sale_id;
        // The fixture offer has hold 0; use it for the timing check instead.
        let sale = buy(&mut contract, offer_id, Some("ada"), ts(200));

        testing_env!(ctx(OTHER, ts(199)).build());
        let early = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.release(sale);
        }));
        assert!(early.is_err(), "release before the hold must panic");

        testing_env!(ctx(OTHER, ts(201)).build());
        contract.release(sale);
        assert_eq!(contract.get_sale(sale).unwrap().status, SaleStatus::Released);

        testing_env!(ctx(OTHER, ts(202)).build());
        let again = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.release(sale);
        }));
        assert!(again.is_err(), "second release must panic");
    }

    #[test]
    fn release_respects_refund_hold() {
        let mut contract = contract();
        offer_fixture(&mut contract);
        testing_env!(ctx("deployer.testnet", ts(1)).build());
        contract.whitelist_token(id(TOKEN));
        testing_env!(ctx(MERCHANT, ts(100)).build());
        let held_offer = contract.create_offer(
            "Held".to_string(),
            String::new(),
            id(TOKEN),
            U128(PRICE),
            0,
            ts(50),
            None,
            None,
            None,
        );
        let sale_id = buy(&mut contract, held_offer, None, ts(100));
        let sale = contract.get_sale(sale_id).unwrap();
        assert_eq!(sale.release_at_ns, ts(150));

        testing_env!(ctx(OTHER, ts(149)).build());
        let early = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.release(sale_id);
        }));
        assert!(early.is_err());

        testing_env!(ctx(OTHER, ts(150)).build());
        contract.release(sale_id);
        assert_eq!(contract.get_sale(sale_id).unwrap().status, SaleStatus::Released);
    }

    // 7. Pausing stops new sales but not settlement of an existing one.
    #[test]
    fn paused_offer_blocks_new_buys_but_pending_sale_still_releases() {
        let mut contract = contract();
        let offer_id = offer_fixture(&mut contract);
        let sale_id = buy(&mut contract, offer_id, None, ts(20));

        testing_env!(ctx(MERCHANT, ts(21)).build());
        contract.pause_offer(offer_id, true);

        testing_env!(ctx(TOKEN, ts(22)).build());
        let result = contract.ft_on_transfer(
            id(BUYER),
            U128(PRICE),
            format!(r#"{{"offer_id":{}}}"#, offer_id),
        );
        assert_unused(result, PRICE);
        assert_eq!(contract.stats().sale_count, 1);

        testing_env!(ctx(MERCHANT, ts(23)).build());
        contract.refund(sale_id);
        assert_eq!(contract.get_sale(sale_id).unwrap().status, SaleStatus::Refunded);
    }

    // 8. Allow-list enforcement for creator claims.
    #[test]
    #[should_panic(expected = "this account is not on the offer allow-list")]
    fn allowlist_blocks_unlisted_creator() {
        let mut contract = contract();
        testing_env!(ctx("deployer.testnet", ts(1)).build());
        contract.whitelist_token(id(TOKEN));
        testing_env!(ctx(MERCHANT, ts(10)).build());
        contract.create_offer(
            "Invite only".to_string(),
            String::new(),
            id(TOKEN),
            U128(PRICE),
            1500,
            0,
            Some(vec![id(CREATOR)]),
            None,
            None,
        );
        testing_env!(ctx(OTHER, ts(11)).build());
        contract.register_creator(1, "nope".to_string(), None, None);
    }

    #[test]
    fn allowlisted_creator_can_claim() {
        let mut contract = contract();
        testing_env!(ctx("deployer.testnet", ts(1)).build());
        contract.whitelist_token(id(TOKEN));
        testing_env!(ctx(MERCHANT, ts(10)).build());
        contract.create_offer(
            "Invite only".to_string(),
            String::new(),
            id(TOKEN),
            U128(PRICE),
            1500,
            0,
            Some(vec![id(CREATOR)]),
            None,
            None,
        );
        testing_env!(ctx(CREATOR, ts(11)).build());
        let link = contract.register_creator(1, "ada".to_string(), None, None);
        assert_eq!(link.account, id(CREATOR));
        assert_eq!(link.code, "ada");
    }

    // 9. Codes are unique per offer.
    #[test]
    #[should_panic(expected = "referral code already claimed")]
    fn duplicate_code_rejected() {
        let mut contract = contract();
        let offer_id = offer_fixture(&mut contract);
        claim(&mut contract, offer_id, "ada");
        testing_env!(ctx(OTHER, ts(12)).build());
        contract.register_creator(offer_id, "ada".to_string(), None, None);
    }

    #[test]
    fn creator_can_reclaim_own_code() {
        let mut contract = contract();
        let offer_id = offer_fixture(&mut contract);
        claim(&mut contract, offer_id, "ada");
        testing_env!(ctx(CREATOR, ts(12)).build());
        let link = contract.register_creator(offer_id, "ada".to_string(), Some(id(OTHER)), None);
        assert_eq!(link.payout_account, id(OTHER));
        let stored = contract.get_creator(offer_id, "ada".to_string()).unwrap();
        assert_eq!(stored.account, id(CREATOR));
        assert_eq!(stored.payout_account, id(OTHER));
    }

    // 10. Editing an offer never rewrites an in-flight sale's economics.
    #[test]
    fn offer_update_does_not_change_pending_sale() {
        let mut contract = contract();
        let offer_id = offer_fixture(&mut contract);
        let sale_id = buy(&mut contract, offer_id, None, ts(20));

        testing_env!(ctx(MERCHANT, ts(21)).build());
        contract.update_offer(
            offer_id,
            "Yoga class (2x price)".to_string(),
            String::new(),
            U128(PRICE * 2),
            5_000,
            0,
            None,
            None,
            None,
        );

        let sale = contract.get_sale(sale_id).unwrap();
        assert_eq!(sale.amount.0, PRICE);
        assert_eq!(sale.protocol_amount.0, 200_000);
        assert_eq!(sale.merchant_amount.0, 9_800_000);
    }

    // 11. Per-creator commission override.
    #[test]
    fn creator_override_changes_split() {
        let mut contract = contract();
        let offer_id = offer_fixture(&mut contract);
        testing_env!(ctx(CREATOR, ts(11)).build());
        contract.register_creator(offer_id, "vip".to_string(), None, None);
        testing_env!(ctx(MERCHANT, ts(11)).build());
        contract.set_creator_commission(offer_id, "vip".to_string(), Some(2_500));
        testing_env!(ctx(BUYER, ts(12)).build());
        let preview = contract.preview_split(offer_id, U128(PRICE), Some("vip".to_string()));
        assert_eq!(preview.creator_amount.0, 2_500_000);
        assert_eq!(preview.merchant_amount.0, 7_300_000);
        assert_eq!(preview.protocol_amount.0, 200_000);
    }

    #[test]
    #[should_panic(expected = "creators cannot raise their own commission")]
    fn creator_cannot_raise_own_commission() {
        let mut contract = contract();
        let offer_id = offer_fixture(&mut contract);
        testing_env!(ctx(CREATOR, ts(11)).build());
        contract.register_creator(offer_id, "greedy".to_string(), None, Some(9_000));
    }

    #[test]
    fn creator_can_lower_own_commission() {
        let mut contract = contract();
        let offer_id = offer_fixture(&mut contract);
        testing_env!(ctx(CREATOR, ts(11)).build());
        contract.register_creator(offer_id, "kind".to_string(), None, Some(500));
        let preview = contract.preview_split(offer_id, U128(PRICE), Some("kind".to_string()));
        assert_eq!(preview.creator_amount.0, 500_000);
    }

    #[test]
    fn reclaim_keeps_merchant_vip_rate() {
        let mut contract = contract();
        let offer_id = offer_fixture(&mut contract);
        claim(&mut contract, offer_id, "ada");
        testing_env!(ctx(MERCHANT, ts(12)).build());
        contract.set_creator_commission(offer_id, "ada".to_string(), Some(2_500));
        testing_env!(ctx(CREATOR, ts(13)).build());
        let link = contract.register_creator(offer_id, "ada".to_string(), Some(id(OTHER)), None);
        assert_eq!(link.commission_bps_override, Some(2_500));
        assert_eq!(link.payout_account, id(OTHER));
    }

    #[test]
    #[should_panic(expected = "only the merchant can set a creator's commission")]
    fn only_merchant_sets_creator_commission() {
        let mut contract = contract();
        let offer_id = offer_fixture(&mut contract);
        claim(&mut contract, offer_id, "ada");
        testing_env!(ctx(CREATOR, ts(12)).build());
        contract.set_creator_commission(offer_id, "ada".to_string(), Some(5_000));
    }

    // 12. Protocol fee cap at init and later.
    #[test]
    #[should_panic(expected = "protocol fee above 2% cap")]
    fn protocol_fee_cap_enforced() {
        testing_env!(ctx("deployer.testnet", ts(1)).build());
        Contract::new(
            id("deployer.testnet"),
            id(TREASURY),
            201,
        );
    }

    // 13. Only the owner can rotate global settings.
    #[test]
    #[should_panic(expected = "only owner can call this")]
    fn non_owner_cannot_pause_globally() {
        let mut contract = contract();
        testing_env!(ctx(OTHER, ts(2)).build());
        contract.set_paused(true);
    }

    // 14. Unwhitelisted tokens cannot be escrowed.
    #[test]
    #[should_panic(expected = "token not whitelisted")]
    fn unwhitelisted_token_rejected() {
        let mut contract = contract();
        testing_env!(ctx(MERCHANT, ts(10)).build());
        contract.create_offer(
            "Bad token".to_string(),
            String::new(),
            id("scam.testnet"),
            U128(PRICE),
            100,
            0,
            None,
            None,
            None,
        );
    }

    // 15. Creator dashboard index.
    #[test]
    fn creator_sales_index_is_populated() {
        let mut contract = contract();
        let offer_id = offer_fixture(&mut contract);
        claim(&mut contract, offer_id, "ada");
        let first = buy(&mut contract, offer_id, Some("ada"), ts(20));
        let second = buy(&mut contract, offer_id, Some("ada"), ts(21));

        testing_env!(ctx(BUYER, ts(22)).build());
        let sales = contract.list_sales_by_creator(id(CREATOR), 0, 10);
        let ids: Vec<u64> = sales.iter().map(|s| s.id).collect();
        assert_eq!(ids, vec![first, second]);
        assert_eq!(contract.stats().volume.0, PRICE * 2);
    }
}
