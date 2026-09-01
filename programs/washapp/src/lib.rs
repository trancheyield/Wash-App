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
}
