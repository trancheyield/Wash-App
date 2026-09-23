use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;

use instructions::*;
use math::Tranche;

declare_id!("2Yq39tVgTH5e8be8YdssyhvM6339f2WG6QweNmxGpBbf");

#[program]
pub mod washapp {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>, faucet_cap: u64) -> Result<()> {
        instructions::init_config_handler(ctx, faucet_cap)
    }

    pub fn faucet(ctx: Context<Faucet>, amount: u64) -> Result<()> {
        instructions::faucet_handler(ctx, amount)
    }

    pub fn create_pool(ctx: Context<CreatePool>, id: u16, params: PoolParams) -> Result<()> {
        instructions::create_pool_handler(ctx, id, params)
    }

    pub fn accrue(ctx: Context<Accrue>) -> Result<()> {
        instructions::accrue_handler(ctx)
    }

    pub fn deposit(ctx: Context<Deposit>, tranche: Tranche, amount: u64) -> Result<()> {
        instructions::deposit_handler(ctx, tranche, amount)
    }

    pub fn redeem(ctx: Context<Redeem>, tranche: Tranche, shares: u64) -> Result<()> {
        instructions::redeem_handler(ctx, tranche, shares)
    }

    pub fn record_loss(ctx: Context<RecordLoss>, loss_bps: u16) -> Result<()> {
        instructions::record_loss_handler(ctx, loss_bps)
    }

    pub fn init_protection(
        ctx: Context<InitProtection>,
        premium_rate_bps: u16,
        trigger_bps: u16,
        premium_fee_bps: u16,
    ) -> Result<()> {
        instructions::init_protection_handler(ctx, premium_rate_bps, trigger_bps, premium_fee_bps)
    }

    pub fn provide_protection(ctx: Context<ProvideProtection>, amount: u64) -> Result<()> {
        instructions::provide_protection_handler(ctx, amount)
    }

    pub fn withdraw_protection(ctx: Context<WithdrawProtection>, shares: u64) -> Result<()> {
        instructions::withdraw_protection_handler(ctx, shares)
    }

    pub fn buy_protection(
        ctx: Context<BuyProtection>,
        notional: u64,
        term: u64,
        nonce: u64,
    ) -> Result<()> {
        instructions::buy_protection_handler(ctx, notional, term, nonce)
    }
}
