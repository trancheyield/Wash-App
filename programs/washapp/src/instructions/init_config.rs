use anchor_lang::prelude::*;

use crate::errors::WashError;
use crate::state::Config;

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Config::INIT_SPACE,
        seeds = [Config::SEED],
        bump,
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn init_config_handler(ctx: Context<InitConfig>, faucet_cap: u64) -> Result<()> {
    require!(faucet_cap > 0, WashError::ParameterOutOfRange);
    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.faucet_cap = faucet_cap;
    config.bump = ctx.bumps.config;
    Ok(())
}
