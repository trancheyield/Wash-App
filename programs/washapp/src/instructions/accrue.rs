use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};

use crate::errors::WashError;
use crate::events::Accrued;
use crate::math::{self, Accrual};
use crate::state::{Config, Pool};

#[derive(Accounts)]
pub struct Accrue<'info> {
    #[account(seeds = [Config::SEED], bump = config.bump, has_one = mint, has_one = treasury)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub treasury: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [Pool::SEED, &pool.id.to_le_bytes()],
        bump = pool.bump,
        has_one = mint,
        has_one = vault,
        has_one = senior_mint,
        has_one = junior_mint,
    )]
    pub pool: Account<'info, Pool>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    pub senior_mint: Account<'info, Mint>,
    pub junior_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

pub fn accrue_handler(ctx: Context<Accrue>) -> Result<()> {
    let Accrue {
        config,
        mint,
        treasury,
        pool,
        vault,
        senior_mint,
        junior_mint,
        token_program,
    } = &mut *ctx.accounts;
    accrue_pool(AccruePool {
        config,
        pool,
        mint,
        vault,
        treasury,
        senior_mint,
        junior_mint,
        token_program,
    })
    .map(|_| ())
}

// Спільний крок «довести пул до зараз»: `accrue` — лише crank, а deposit,
// redeem і record_loss кличуть це першим, тому порядок у блоці не змінює
// результату. Розкладка акаунтів у їхніх контекстах повторює `Accrue`.
pub struct AccruePool<'a, 'info> {
    pub config: &'a Account<'info, Config>,
    pub pool: &'a mut Account<'info, Pool>,
    pub mint: &'a Account<'info, Mint>,
    pub vault: &'a Account<'info, TokenAccount>,
    pub treasury: &'a Account<'info, TokenAccount>,
    pub senior_mint: &'a Account<'info, Mint>,
    pub junior_mint: &'a Account<'info, Mint>,
    pub token_program: &'a Program<'info, Token>,
}

pub fn accrue_pool(a: AccruePool) -> Result<Accrual> {
    let pool = a.pool;
    // Годинник ланцюга не йде назад; якби пішов — рахуємо нуль і не зсуваємо
    // позначку назад, а не відмовляємо: crank не має ламати депозит.
    let now = Clock::get()?.unix_timestamp.max(pool.last_accrued_ts);
    let elapsed = (now - pool.last_accrued_ts) as u64;
    let dt_model = elapsed
        .checked_mul(pool.time_scale as u64)
        .ok_or(WashError::Overflow)?;

    let balances = pool.balances(a.senior_mint.supply, a.junior_mint.supply);
    let accrual = math::accrue(&balances, &pool.rates(), dt_model)?;
    let next = balances.after_accrual(&accrual)?;

    let net = accrual
        .senior_gain
        .checked_add(accrual.junior_gain)
        .ok_or(WashError::Overflow)?;
    let bump = [a.config.bump];
    let signer: &[&[&[u8]]] = &[&[Config::SEED, &bump]];
    for (to, amount) in [(a.vault, net), (a.treasury, accrual.fee)] {
        if amount == 0 {
            continue;
        }
        token::mint_to(
            CpiContext::new_with_signer(
                a.token_program.key(),
                MintTo {
                    mint: a.mint.to_account_info(),
                    to: to.to_account_info(),
                    authority: a.config.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;
    }

    pool.set_balances(&next);
    pool.model_time = pool
        .model_time
        .checked_add(dt_model)
        .ok_or(WashError::Overflow)?;
    pool.last_accrued_ts = now;

    emit!(Accrued {
        pool: pool.key(),
        model_time: pool.model_time,
        dt_model,
        yield_amount: accrual.yield_amount,
        fee: accrual.fee,
        senior_gain: accrual.senior_gain,
        junior_gain: accrual.junior_gain,
    });
    Ok(accrual)
}
