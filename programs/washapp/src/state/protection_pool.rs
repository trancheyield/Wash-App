use anchor_lang::prelude::*;

// Один спільний захисний пул на пул траншів. Продавецькі частки — не мінт,
// тому `share_supply` живе тут.
#[account]
#[derive(InitSpace)]
pub struct ProtectionPool {
    pub pool: Pubkey,
    pub pvault: Pubkey,
    pub premium_rate_bps: u16,
    pub trigger_bps: u16,
    pub premium_fee_bps: u16,
    pub collateral: u64,
    // Сума notional активних контрактів; вільне забезпечення = collateral − reserved.
    pub reserved: u64,
    pub share_supply: u64,
    // Лічильник виданих контрактів — джерело nonce для клієнта.
    pub contracts: u64,
    pub bump: u8,
}

impl ProtectionPool {
    pub const SEED: &'static [u8] = crate::constants::PROTECTION_SEED;
}
