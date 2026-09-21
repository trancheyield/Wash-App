use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::WashError;
use crate::math;
use crate::state::{Pool, ProtectionPool, SellerPosition};

// Захисний пул не нараховує доходу і часу не веде — `accrue` тут не потрібен:
// вартість частки продавця змінюють лише премії й виплати, а їх приносять
// `buy_protection`/`settle_protection`, які накручують годинник самі.
#[derive(Accounts)]
pub struct ProvideProtection<'info> {
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
    // Одна позиція на продавця й пул: повторний внесок додає частки до неї.
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + SellerPosition::INIT_SPACE,
        seeds = [SellerPosition::SEED, pool.key().as_ref(), owner.key().as_ref()],
        bump,
    )]
    pub position: Account<'info, SellerPosition>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn provide_protection_handler(ctx: Context<ProvideProtection>, amount: u64) -> Result<()> {
    require!(amount > 0, WashError::ZeroAmount);
    let ProvideProtection {
        pool,
        protection,
        pvault,
        owner_ata,
        position,
        owner,
        token_program,
        system_program: _,
    } = &mut *ctx.accounts;

    let shares =
        math::shares_for_collateral(amount, protection.collateral, protection.share_supply)?;
    // Внесок, що округлюється до нуля часток, був би подарунком старим продавцям.
    require!(shares > 0, WashError::ZeroAmount);

    token::transfer(
        CpiContext::new(
            token_program.key(),
            Transfer {
                from: owner_ata.to_account_info(),
                to: pvault.to_account_info(),
                authority: owner.to_account_info(),
            },
        ),
        amount,
    )?;

    protection.collateral = protection
        .collateral
        .checked_add(amount)
        .ok_or(WashError::Overflow)?;
    protection.share_supply = protection
        .share_supply
        .checked_add(shares)
        .ok_or(WashError::Overflow)?;
    // Поля позиції — щоразу, не лише при створенні: на щойно створеному акаунті
    // вони нульові, а на наявному збігаються з seeds і запис нічого не змінює.
    position.pool = pool.key();
    position.owner = owner.key();
    position.bump = ctx.bumps.position;
    position.shares = position
        .shares
        .checked_add(shares)
        .ok_or(WashError::Overflow)?;
    Ok(())
}
