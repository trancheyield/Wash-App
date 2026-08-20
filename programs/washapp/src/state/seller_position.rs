use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct SellerPosition {
    pub pool: Pubkey,
    pub owner: Pubkey,
    pub shares: u64,
    pub bump: u8,
}

impl SellerPosition {
    pub const SEED: &'static [u8] = crate::constants::SELLER_SEED;
}
