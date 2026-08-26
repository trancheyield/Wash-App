use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::{DEMO_MINT_DECIMALS, MINT_SEED, TREASURY_SEED};
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
    // Демо-токен: карбує лише програма (`faucet` і дохід `accrue`), тому
    // authority — сам `Config`; freeze authority відсутній свідомо.
    #[account(
        init,
        payer = authority,
        seeds = [MINT_SEED],
        bump,
        mint::decimals = DEMO_MINT_DECIMALS,
        mint::authority = config,
    )]
    pub mint: Account<'info, Mint>,
    // Комісії належать оператору: адреса — PDA, щоб `accrue` знаходив її без
    // довіри до клієнта, а authority — гаманець оператора, щоб забрати їх
    // звичайним SPL-переказом без окремої інструкції.
    #[account(
        init,
        payer = authority,
        seeds = [TREASURY_SEED],
        bump,
        token::mint = mint,
        token::authority = authority,
    )]
    pub treasury: Account<'info, TokenAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn init_config_handler(ctx: Context<InitConfig>, faucet_cap: u64) -> Result<()> {
    require!(faucet_cap > 0, WashError::ParameterOutOfRange);
    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.mint = ctx.accounts.mint.key();
    config.treasury = ctx.accounts.treasury.key();
    config.faucet_cap = faucet_cap;
    config.bump = ctx.bumps.config;
    Ok(())
}
