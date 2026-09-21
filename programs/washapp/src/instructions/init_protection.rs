use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::{MAX_BPS, PVAULT_SEED};
use crate::errors::WashError;
use crate::state::{Pool, ProtectionPool};

// Окремо від `create_pool`: п'ять `init` в одному кадрі `try_accounts` не
// вміщаються в 4 КіБ під SBPFv0 (PLAN, ризик #1).
#[derive(Accounts)]
pub struct InitProtection<'info> {
    #[account(
        seeds = [Pool::SEED, &pool.id.to_le_bytes()],
        bump = pool.bump,
        has_one = mint,
        has_one = operator @ WashError::Unauthorized,
    )]
    pub pool: Account<'info, Pool>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = operator,
        space = 8 + ProtectionPool::INIT_SPACE,
        seeds = [ProtectionPool::SEED, pool.key().as_ref()],
        bump,
    )]
    pub protection: Account<'info, ProtectionPool>,
    // Забезпечення продавців і премії лежать окремо від vault пулу: інваріант
    // `assets == vault.amount` захисту не стосується.
    #[account(
        init,
        payer = operator,
        seeds = [PVAULT_SEED, pool.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = protection,
    )]
    pub pvault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub operator: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn init_protection_handler(
    ctx: Context<InitProtection>,
    premium_rate_bps: u16,
    trigger_bps: u16,
    premium_fee_bps: u16,
) -> Result<()> {
    require!(premium_rate_bps <= MAX_BPS, WashError::ParameterOutOfRange);
    require!(trigger_bps <= MAX_BPS, WashError::ParameterOutOfRange);
    require!(premium_fee_bps <= MAX_BPS, WashError::ParameterOutOfRange);
    let protection = &mut ctx.accounts.protection;
    protection.pool = ctx.accounts.pool.key();
    protection.pvault = ctx.accounts.pvault.key();
    protection.premium_rate_bps = premium_rate_bps;
    protection.trigger_bps = trigger_bps;
    protection.premium_fee_bps = premium_fee_bps;
    protection.collateral = 0;
    protection.reserved = 0;
    protection.share_supply = 0;
    protection.contracts = 0;
    protection.bump = ctx.bumps.protection;
    Ok(())
}
