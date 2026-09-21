use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::WashError;
use crate::math;
use crate::state::{Pool, ProtectionPool, SellerPosition};

// Дзеркало `ProvideProtection`: ті самі акаунти, переказ у зворотний бік,
// позиція вже існує.
#[derive(Accounts)]
pub struct WithdrawProtection<'info> {
    #[account(seeds = [Pool::SEED, &pool.id.to_le_bytes()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(
        mut,
        seeds = [ProtectionPool::SEED, pool.key().as_ref()],
        bump = protection.bump,
    )]
    pub protection: Account<'info, ProtectionPool>,
    /// CHECK: address is pinned to `protection.pvault`; SPL Token reads it in the CPI
    #[account(mut, address = protection.pvault)]
    pub pvault: UncheckedAccount<'info>,
    #[account(mut, token::mint = pool.mint, token::authority = owner)]
    pub owner_ata: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [SellerPosition::SEED, pool.key().as_ref(), owner.key().as_ref()],
        bump = position.bump,
    )]
    pub position: Account<'info, SellerPosition>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn withdraw_protection_handler(ctx: Context<WithdrawProtection>, shares: u64) -> Result<()> {
    require!(shares > 0, WashError::ZeroAmount);
    let WithdrawProtection {
        pool,
        protection,
        pvault,
        owner_ata,
        position,
        owner: _,
        token_program,
    } = &mut *ctx.accounts;
    require!(shares <= position.shares, WashError::ParameterOutOfRange);

    let amount =
        math::collateral_for_shares(shares, protection.collateral, protection.share_supply)?;
    // Частки, що коштують нуль після виплат, не спалюються за ніщо.
    require!(amount > 0, WashError::ZeroAmount);
    // Зарезервоване під активні контракти лишається в pvault до врегулювання
    // або спливу — вивести можна лише вільну частину.
    let free = protection
        .collateral
        .checked_sub(protection.reserved)
        .ok_or(WashError::Overflow)?;
    require!(amount <= free, WashError::InsufficientFreeCollateral);

    let pool_key = pool.key();
    let bump = [protection.bump];
    let signer: &[&[&[u8]]] = &[&[ProtectionPool::SEED, pool_key.as_ref(), &bump]];
    token::transfer(
        CpiContext::new_with_signer(
            token_program.key(),
            Transfer {
                from: pvault.to_account_info(),
                to: owner_ata.to_account_info(),
                authority: protection.to_account_info(),
            },
            signer,
        ),
        amount,
    )?;

    protection.collateral = protection
        .collateral
        .checked_sub(amount)
        .ok_or(WashError::Overflow)?;
    protection.share_supply = protection
        .share_supply
        .checked_sub(shares)
        .ok_or(WashError::Overflow)?;
    position.shares = position
        .shares
        .checked_sub(shares)
        .ok_or(WashError::Overflow)?;
    Ok(())
}
