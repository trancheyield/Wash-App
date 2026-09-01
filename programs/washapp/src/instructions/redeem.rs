use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Token, TokenAccount, Transfer};

use crate::errors::WashError;
use crate::events::Redeemed;
use crate::instructions::{accrue_pool, token_amount, AccruePool};
use crate::math::{self, Tranche};
use crate::state::{Config, Pool};

// Розкладка повторює `Deposit` (див. коментар там про кадр): ті самі акаунти,
// лише напрямок переказу зворотний.
#[derive(Accounts)]
#[instruction(tranche: Tranche)]
pub struct Redeem<'info> {
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
    #[account(mut, token::mint = mint, token::authority = owner)]
    pub owner_ata: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::authority = owner,
        constraint = owner_tranche_ata.mint == pool.tranche_mint(tranche) @ WashError::ParameterOutOfRange,
    )]
    pub owner_tranche_ata: Account<'info, TokenAccount>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn redeem_handler(ctx: Context<Redeem>, tranche: Tranche, shares: u64) -> Result<()> {
    require!(shares > 0, WashError::ZeroAmount);
    let Redeem {
        config,
        mint,
        treasury,
        pool,
        vault,
        senior_mint,
        junior_mint,
        owner_ata,
        owner_tranche_ata,
        owner,
        token_program,
    } = &mut *ctx.accounts;
    let ap = AccruePool {
        config,
        mint: mint.to_account_info(),
        vault: vault.to_account_info(),
        treasury: treasury.to_account_info(),
        senior_mint: senior_mint.to_account_info(),
        junior_mint: junior_mint.to_account_info(),
        token_program: token_program.to_account_info(),
    };
    let balances = accrue_pool(&ap, pool)?;

    let (tranche_assets, supply) = balances.tranche(tranche);
    let amount = math::amount_for_redeem(shares, tranche_assets, supply)?;
    // Частки, що коштують нуль після збитку, не спалюються за ніщо.
    require!(amount > 0, WashError::ZeroAmount);
    // За інваріантом vault == assets ≥ tranche_assets ≥ amount; перевірка лишається
    // як сторож на випадок, якщо інваріант колись зламається.
    require!(
        amount <= token_amount(&ap.vault)?,
        WashError::InsufficientLiquidity
    );
    let next = balances.after_redeem(tranche, shares, amount)?;
    if tranche == Tranche::Junior {
        require!(
            math::subordination_ok(next.senior_assets, next.junior_assets, pool.min_junior_bps),
            WashError::SubordinationBreached
        );
    }

    let tranche_mint = match tranche {
        Tranche::Senior => ap.senior_mint.clone(),
        Tranche::Junior => ap.junior_mint.clone(),
    };
    token::burn(
        CpiContext::new(
            ap.token_program.key(),
            Burn {
                mint: tranche_mint,
                from: owner_tranche_ata.to_account_info(),
                authority: owner.to_account_info(),
            },
        ),
        shares,
    )?;
    let id = pool.id.to_le_bytes();
    let bump = [pool.bump];
    let signer: &[&[&[u8]]] = &[&[Pool::SEED, &id, &bump]];
    token::transfer(
        CpiContext::new_with_signer(
            ap.token_program.key(),
            Transfer {
                from: ap.vault.clone(),
                to: owner_ata.to_account_info(),
                authority: pool.to_account_info(),
            },
            signer,
        ),
        amount,
    )?;

    pool.set_balances(&next);
    emit!(Redeemed {
        pool: pool.key(),
        owner: owner.key(),
        tranche,
        shares,
        amount,
    });
    Ok(())
}
