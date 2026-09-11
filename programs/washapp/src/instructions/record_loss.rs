use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Token};

use crate::constants::MAX_BPS;
use crate::errors::WashError;
use crate::events::LossRecorded;
use crate::instructions::{accrue_pool, AccruePool};
use crate::math;
use crate::state::{Config, LossEvent, Pool};

// Розкладка повторює `Deposit` (див. коментар там про кадр); замість акаунтів
// вкладника — новий `LossEvent` під індексом `pool.loss_count`, тож повторно
// той самий індекс не запишеться: PDA вже існує.
#[derive(Accounts)]
pub struct RecordLoss<'info> {
    #[account(seeds = [Config::SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// CHECK: address is pinned to `config.mint`; SPL Token reads it in the CPI
    #[account(mut, address = config.mint)]
    pub mint: UncheckedAccount<'info>,
    /// CHECK: address is pinned to `config.treasury`; SPL Token reads it in the CPI
    #[account(mut, address = config.treasury)]
    pub treasury: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [Pool::SEED, &pool.id.to_le_bytes()],
        bump = pool.bump,
        has_one = mint,
        has_one = operator @ WashError::Unauthorized,
    )]
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
        init,
        payer = operator,
        space = 8 + LossEvent::INIT_SPACE,
        seeds = [LossEvent::SEED, pool.key().as_ref(), &pool.loss_count.to_le_bytes()],
        bump,
    )]
    pub loss_event: Account<'info, LossEvent>,
    #[account(mut)]
    pub operator: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn record_loss_handler(ctx: Context<RecordLoss>, loss_bps: u16) -> Result<()> {
    require!(loss_bps <= MAX_BPS, WashError::ParameterOutOfRange);
    let RecordLoss {
        config,
        mint,
        treasury,
        pool,
        vault,
        senior_mint,
        junior_mint,
        loss_event,
        operator: _,
        token_program,
        system_program: _,
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
    // Збиток — від активів на момент події, тому спершу доводимо пул до зараз.
    let balances = accrue_pool(&ap, pool)?;

    let amount = math::loss_amount(balances.assets, loss_bps)?;
    // Нульовий збиток (bps = 0 або замалий пул) події не лишає: в історії не
    // з'являється запис, який нічого не змінив, а в M2 не спричиняє виплат.
    require!(amount > 0, WashError::ZeroAmount);
    let split = math::apply_loss(amount, balances.senior_assets, balances.junior_assets)?;
    let next = balances.after_loss(&split)?;

    // Збиток спалюється з vault: інваріант `assets == vault.amount` тримається
    // байт у байт, а не «vault зберігає втрачене».
    let id = pool.id.to_le_bytes();
    let bump = [pool.bump];
    let signer: &[&[&[u8]]] = &[&[Pool::SEED, &id, &bump]];
    token::burn(
        CpiContext::new_with_signer(
            ap.token_program.key(),
            Burn {
                mint: ap.mint.clone(),
                from: ap.vault.clone(),
                authority: pool.to_account_info(),
            },
            signer,
        ),
        amount,
    )?;

    let index = pool.loss_count;
    loss_event.set_inner(LossEvent {
        pool: pool.key(),
        index,
        ts: pool.last_accrued_ts,
        model_time: pool.model_time,
        loss_bps,
        amount,
        junior_loss: split.junior_loss,
        senior_loss: split.senior_loss,
        assets_before: balances.assets,
        bump: ctx.bumps.loss_event,
    });
    pool.set_balances(&next);
    pool.loss_count = index.checked_add(1).ok_or(WashError::Overflow)?;

    emit!(LossRecorded {
        pool: pool.key(),
        index,
        model_time: pool.model_time,
        loss_bps,
        amount,
        junior_loss: split.junior_loss,
        senior_loss: split.senior_loss,
    });
    Ok(())
}
