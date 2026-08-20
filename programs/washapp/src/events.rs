// Події — для `tools/demo` і логів; інтерфейс читає акаунти, не події.
use anchor_lang::prelude::*;

use crate::math::Tranche;

#[event]
pub struct Accrued {
    pub pool: Pubkey,
    pub model_time: u64,
    pub dt_model: u64,
    pub yield_amount: u64,
    pub fee: u64,
    pub senior_gain: u64,
    pub junior_gain: u64,
}

#[event]
pub struct Deposited {
    pub pool: Pubkey,
    pub owner: Pubkey,
    pub tranche: Tranche,
    pub amount: u64,
    pub shares: u64,
}

#[event]
pub struct Redeemed {
    pub pool: Pubkey,
    pub owner: Pubkey,
    pub tranche: Tranche,
    pub shares: u64,
    pub amount: u64,
}

#[event]
pub struct LossRecorded {
    pub pool: Pubkey,
    pub index: u32,
    pub model_time: u64,
    pub loss_bps: u16,
    pub amount: u64,
    pub junior_loss: u64,
    pub senior_loss: u64,
}

#[event]
pub struct ProtectionBought {
    pub pool: Pubkey,
    pub contract: Pubkey,
    pub buyer: Pubkey,
    pub nonce: u64,
    pub notional: u64,
    pub premium: u64,
    pub expiry_model_time: u64,
}

#[event]
pub struct ProtectionSettled {
    pub pool: Pubkey,
    pub contract: Pubkey,
    pub loss_index: u32,
    pub payout: u64,
}

#[event]
pub struct ProtectionExpired {
    pub pool: Pubkey,
    pub contract: Pubkey,
}
