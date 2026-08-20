use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContractStatus {
    Active,
    Settled,
    Expired,
}

#[account]
#[derive(InitSpace)]
pub struct ProtectionContract {
    pub pool: Pubkey,
    pub buyer: Pubkey,
    pub nonce: u64,
    pub notional: u64,
    pub premium: u64,
    pub start_model_time: u64,
    pub expiry_model_time: u64,
    // Знімок порогу на момент купівлі — зміна параметрів пулу контракт не чіпає.
    pub trigger_bps: u16,
    // Події з індексом нижче не покриваються: збиток до купівлі — не страховий випадок.
    pub loss_index_from: u32,
    pub status: ContractStatus,
    pub settled_loss_index: u32,
    pub payout: u64,
    pub bump: u8,
}

impl ProtectionContract {
    pub const SEED: &'static [u8] = crate::constants::CONTRACT_SEED;
}
