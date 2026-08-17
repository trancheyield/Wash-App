// Модельний рік: усі ставки `*_bps` — річні, час пулу — модельні секунди.
pub const YEAR_SECONDS: u64 = 365 * 86_400;
pub const BPS_DENOMINATOR: u64 = 10_000;
pub const DEMO_MINT_DECIMALS: u8 = 6;

pub const CONFIG_SEED: &[u8] = b"config";
