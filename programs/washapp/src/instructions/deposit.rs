use anchor_lang::prelude::*;
use anchor_spl::token::{self, MintTo, Token, TokenAccount, Transfer};

use crate::errors::WashError;
use crate::events::Deposited;
use crate::instructions::{accrue_pool, AccruePool};
use crate::math::{self, Tranche};
use crate::state::{Config, Pool};

// П'ять акаунтів пулу — `UncheckedAccount` з `address =`: типізовані
// `Account<Mint>`/`Account<TokenAccount>` разом із `init_if_needed` для ATA
// траншу давали кадр `try_accounts` 5 632 Б проти стелі 4 096 під SBPFv0.
// ATA траншу створює клієнт (`createAssociatedTokenIdempotent` перед
// депозитом); типізованими лишаються лише акаунти вкладника.
#[derive(Accounts)]
#[instruction(tranche: Tranche)]
pub struct Deposit<'info> {
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

pub fn deposit_handler(ctx: Context<Deposit>, tranche: Tranche, amount: u64) -> Result<()> {
    require!(amount > 0, WashError::ZeroAmount);
    let Deposit {
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
    let shares = math::shares_for_deposit(amount, tranche_assets, supply)?;
    // Внесок, що округлюється до нуля часток, був би подарунком старим держателям.
    require!(shares > 0, WashError::ZeroAmount);
    let next = balances.after_deposit(tranche, amount, shares)?;
    if tranche == Tranche::Senior {
        require!(
            math::subordination_ok(next.senior_assets, next.junior_assets, pool.min_junior_bps),
            WashError::SubordinationBreached
        );
    }

    token::transfer(
        CpiContext::new(
            ap.token_program.key(),
            Transfer {
                from: owner_ata.to_account_info(),
                to: ap.vault.clone(),
                authority: owner.to_account_info(),
            },
        ),
        amount,
    )?;
    let tranche_mint = match tranche {
        Tranche::Senior => ap.senior_mint.clone(),
        Tranche::Junior => ap.junior_mint.clone(),
    };
    let id = pool.id.to_le_bytes();
    let bump = [pool.bump];
    let signer: &[&[&[u8]]] = &[&[Pool::SEED, &id, &bump]];
    token::mint_to(
        CpiContext::new_with_signer(
            ap.token_program.key(),
            MintTo {
                mint: tranche_mint,
                to: owner_tranche_ata.to_account_info(),
                authority: pool.to_account_info(),
            },
            signer,
        ),
        shares,
    )?;

    pool.set_balances(&next);
    emit!(Deposited {
        pool: pool.key(),
        owner: owner.key(),
        tranche,
        amount,
        shares,
    });
    Ok(())
}
