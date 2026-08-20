use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    // Демо-мінт; mint authority — сам `Config`.
    pub mint: Pubkey,
    pub treasury: Pubkey,
    pub faucet_cap: u64,
    pub bump: u8,
}

impl Config {
    pub const SEED: &'static [u8] = crate::constants::CONFIG_SEED;
}
