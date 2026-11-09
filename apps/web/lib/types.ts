/**
 * Shared shapes mirroring the Rust contract JSON output.
 * Every `U128` arrives as a decimal string.
 */

export type U128String = string;

export type SaleStatus = "Pending" | "Released" | "Refunded";

export interface IntentsDest {
  chain: string;
  asset_id: string;
  recipient: string;
}

export interface Offer {
  id: number;
  merchant: string;
  title: string;
  description: string;
  token: string;
  price: U128String;
  commission_bps: number;
  protocol_fee_bps: number;
  refund_hold_ns: number;
  allowed_creators: string[] | null;
  payout_account: string;
  intents_dest: IntentsDest | null;
  paused: boolean;
  created_at_ns: number;
}

export interface CreatorLink {
  offer_id: number;
  account: string;
  code: string;
  commission_bps_override: number | null;
  payout_account: string;
  created_at_ns: number;
}

export interface Sale {
  id: number;
  offer_id: number;
  buyer: string;
  creator: string | null;
  creator_code: string | null;
  amount: U128String;
  created_at_ns: number;
  release_at_ns: number;
  status: SaleStatus;
  creator_bps: number;
  protocol_bps: number;
  merchant_amount: U128String;
  creator_amount: U128String;
  protocol_amount: U128String;
  merchant_payout: string;
  creator_payout: string | null;
}

export interface ProtocolConfig {
  owner: string;
  treasury: string;
  protocol_fee_bps: number;
  paused_global: boolean;
  tokens: string[];
}

export interface SplitPreview {
  amount: U128String;
  creator_bps: number;
  protocol_bps: number;
  merchant_amount: U128String;
  creator_amount: U128String;
  protocol_amount: U128String;
  merchant_payout: string;
  creator_payout: string | null;
  known_creator: boolean;
}

export interface Stats {
  offer_count: number;
  sale_count: number;
  volume: U128String;
}

export interface TokenMeta {
  spec: string;
  name: string;
  symbol: string;
  decimals: number;
}

export interface OfferDraft {
  title: string;
  description: string;
  price: number;
  commission_bps: number;
  refund_hold_hours: number;
  payout_account: string;
  intents_dest: IntentsDest | null;
  rationale: string;
  assumptions: string[];
}

export interface CreatorMatch {
  account: string;
  name: string;
  tags: string[];
  audience: string;
  sampleUrl: string;
  score: number;
  reason: string;
}
