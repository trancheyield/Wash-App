use anchor_lang::prelude::*;

// Незмінний запис збитку: історія читається з ланцюга без сервера.
#[account]
#[derive(InitSpace)]
pub struct LossEvent {
    pub pool: Pubkey,
    pub index: u32,
    pub ts: i64,
    pub model_time: u64,
    pub loss_bps: u16,
    pub amount: u64,
    pub junior_loss: u64,
    pub senior_loss: u64,
    pub assets_before: u64,
    pub bump: u8,
}

impl LossEvent {
    pub const SEED: &'static [u8] = crate::constants::LOSS_SEED;
}
