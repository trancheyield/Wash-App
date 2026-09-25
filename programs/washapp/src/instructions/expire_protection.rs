use anchor_lang::prelude::*;
use anchor_spl::token::Token;

use crate::errors::WashError;
use crate::events::ProtectionExpired;
use crate::instructions::{accrue_pool, AccruePool};
use crate::state::{Config, ContractStatus, Pool, ProtectionContract, ProtectionPool};

// The `RecordLoss` layout without the event record: expiry is measured by the
// pool clock now, and only `accrue` moves that clock. Nothing is transferred, so
// neither pvault nor the buyer's ATA belong here.
#[derive(Accounts)]
pub struct ExpireProtection<'info> {
    #[account(seeds = [Config::SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// CHECK: address is pinned to `config.mint`; SPL Token reads it in the CPI
    #[account(mut, address = config.mint)]
    pub mint: UncheckedAccount<'info>,
    /// CHECK: address is pinned to `config.treasury`; SPL Token reads it in the CPI
    #[account(mut, address = config.treasury)]
    pub treasury: UncheckedAccount<'info>,
    #[account(mut, seeds = [Pool::SEED, &pool.id.to_le_bytes()], bump = pool.bump, has_one = mint)]
    pub pool: Account<'info, Pool>,
    /// CHECK: address is pinned to `pool.vault`; SPL Token reads it in the CPI
    #[account(mut, address = pool.vault)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: address is pinned to `pool.senior_mint`; supply is read in the handler
    #[account(mut, address = pool.senior_mint)]
    pub senior_mint: UncheckedAccount<'info>,
    /// CHECK: address is pinned to `pool.junior_mint`; supply is read in the handler
    #[account(mut, address = pool.junior_mint)]
    pub junior_mint: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [ProtectionPool::SEED, pool.key().as_ref()],
        bump = protection.bump,
    )]
    pub protection: Account<'info, ProtectionPool>,
    #[account(mut, has_one = pool)]
    pub contract: Account<'info, ProtectionContract>,
    pub signer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn expire_protection_handler(ctx: Context<ExpireProtection>) -> Result<()> {
    let ExpireProtection {
        config,
        mint,
        treasury,
        pool,
        vault,
        senior_mint,
        junior_mint,
        protection,
        contract,
        signer,
        token_program,
    } = &mut *ctx.accounts;
    require!(
        contract.status == ContractStatus::Active,
        WashError::ContractNotActive
    );
    // Only the buyer or the pool operator may close a contract (Pavlo's call):
    // otherwise a seller could extinguish a claim that has not been filed yet
    // right after expiry and keep the reserve.
    require!(
        signer.key() == contract.buyer || signer.key() == pool.operator,
        WashError::Unauthorized
    );
    let ap = AccruePool {
        config,
        mint: mint.to_account_info(),
        vault: vault.to_account_info(),
        treasury: treasury.to_account_info(),
        senior_mint: senior_mint.to_account_info(),
        junior_mint: junior_mint.to_account_info(),
        token_program: token_program.to_account_info(),
    };
    // Expiry is measured by the pool clock now, so bring the pool up to it first.
    accrue_pool(&ap, pool)?;
    require!(
        pool.model_time >= contract.expiry_model_time,
        WashError::NotExpired
    );

    // The collateral is untouched: the premium stays with the sellers (FR-010),
    // only this contract's reserve is released.
    protection.reserved = protection
        .reserved
        .checked_sub(contract.notional)
        .ok_or(WashError::Overflow)?;
    contract.status = ContractStatus::Expired;

    emit!(ProtectionExpired {
        pool: pool.key(),
        contract: contract.key(),
    });
    Ok(())
}
