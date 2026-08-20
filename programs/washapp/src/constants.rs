// Модельний рік: усі ставки `*_bps` — річні, час пулу — модельні секунди.
pub const YEAR_SECONDS: u64 = 365 * 86_400;
pub const BPS_DENOMINATOR: u64 = 10_000;
pub const DEMO_MINT_DECIMALS: u8 = 6;

// Межі параметрів: разом із `u128` у `math.rs` гарантують, що добуток
// `assets × bps × dt` не переповнюється на реальних інтервалах.
pub const MAX_BPS: u16 = BPS_DENOMINATOR as u16;
pub const MAX_TIME_SCALE: u32 = 1_000_000;
pub const MAX_TERM_SECONDS: u64 = 10 * YEAR_SECONDS;

// Seeds PDA — дзеркало в `packages/chain/src/pda.ts`, звірене через `fixtures/pda.json`.
pub const CONFIG_SEED: &[u8] = b"config";
pub const MINT_SEED: &[u8] = b"mint";
pub const TREASURY_SEED: &[u8] = b"treasury";
pub const POOL_SEED: &[u8] = b"pool";
pub const VAULT_SEED: &[u8] = b"vault";
pub const SENIOR_MINT_SEED: &[u8] = b"senior";
pub const JUNIOR_MINT_SEED: &[u8] = b"junior";
pub const LOSS_SEED: &[u8] = b"loss";
pub const PROTECTION_SEED: &[u8] = b"protection";
pub const PVAULT_SEED: &[u8] = b"pvault";
pub const SELLER_SEED: &[u8] = b"seller";
pub const CONTRACT_SEED: &[u8] = b"contract";
