use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, Transfer};

use crate::constants::MAX_TERM_SECONDS;
use crate::errors::WashError;
use crate::events::ProtectionBought;
use crate::instructions::{accrue_pool, AccruePool};
use crate::math;
use crate::state::{Config, ContractStatus, Pool, ProtectionContract, ProtectionPool};

// Розкладка — `RecordLoss` (про кадр `try_accounts` див. коментар у `deposit.rs`)
// плюс три акаунти захисту й новий контракт. Акаунти пулу потрібні цілком:
// строк контракту відлічується від часу пулу, а час дає лише `accrue`.
#[derive(Accounts)]
#[instruction(notional: u64, term: u64, nonce: u64)]
pub struct BuyProtection<'info> {
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
    /// CHECK: address is pinned to `protection.pvault`; SPL Token reads it in the CPI
    #[account(mut, address = protection.pvault)]
    pub pvault: UncheckedAccount<'info>,
    // Не типізований: кадр `try_accounts` уже на межі 4 КіБ, а переказ SPL сам
    // вимагає підпису власника і збігу мінта з приймачем (pvault і скарбниця —
    // обидва на демо-мінті), тож розпакування тут нічого не додає.
    /// CHECK: SPL Token checks the owner signature and the mint in the transfer CPI
    #[account(mut)]
    pub buyer_ata: UncheckedAccount<'info>,
    // Один контракт на пару (покупець, nonce): повторний nonce не купиться —
    // PDA вже існує. Лічильник `protection.contracts` дає клієнту наступний.
    #[account(
        init,
        payer = buyer,
        space = 8 + ProtectionContract::INIT_SPACE,
        seeds = [
            ProtectionContract::SEED,
            pool.key().as_ref(),
            buyer.key().as_ref(),
            &nonce.to_le_bytes(),
        ],
        bump,
    )]
    pub contract: Account<'info, ProtectionContract>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn buy_protection_handler(
    ctx: Context<BuyProtection>,
    notional: u64,
    term: u64,
    nonce: u64,
) -> Result<()> {
    require!(notional > 0, WashError::ZeroAmount);
    // Строк 0 — контракт, що спливає у мить купівлі; стеля тримає добуток премії
    // у межах `u64` (`math::premium`).
    require!(
        term > 0 && term <= MAX_TERM_SECONDS,
        WashError::ParameterOutOfRange
    );
    let BuyProtection {
        config,
        mint,
        treasury,
        pool,
        vault,
        senior_mint,
        junior_mint,
        protection,
        pvault,
        buyer_ata,
        contract,
        buyer,
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
    // Строк відлічується від часу пулу «зараз», тому спершу доводимо пул до нього.
    accrue_pool(&ap, pool)?;

    // Вільне забезпечення міряється до премії: покупець не фінансує власне
    // покриття, інакше номінал можна було б узяти більший за чуже забезпечення.
    let free = protection
        .collateral
        .checked_sub(protection.reserved)
        .ok_or(WashError::Overflow)?;
    require!(notional <= free, WashError::InsufficientFreeCollateral);

    let premium = math::premium(notional, protection.premium_rate_bps, term)?;
    // Премія, що округлилась до нуля при ненульовій ставці, була б покриттям
    // задарма за рахунок продавців; ставка 0 — свідомий вибір оператора.
    require!(
        premium > 0 || protection.premium_rate_bps == 0,
        WashError::ZeroAmount
    );
    let fee = math::premium_fee(premium, protection.premium_fee_bps)?;
    let net = premium.checked_sub(fee).ok_or(WashError::Overflow)?;

    // Премія платиться наперед одним підписом покупця: комісія — у скарбницю,
    // решта — у pvault, де дорожчає частка продавця без нових часток.
    for (to, amount) in [(ap.treasury.clone(), fee), (pvault.to_account_info(), net)] {
        if amount == 0 {
            continue;
        }
        token::transfer(
            CpiContext::new(
                ap.token_program.key(),
                Transfer {
                    from: buyer_ata.to_account_info(),
                    to,
                    authority: buyer.to_account_info(),
                },
            ),
            amount,
        )?;
    }

    protection.collateral = protection
        .collateral
        .checked_add(net)
        .ok_or(WashError::Overflow)?;
    protection.reserved = protection
        .reserved
        .checked_add(notional)
        .ok_or(WashError::Overflow)?;
    protection.contracts = protection
        .contracts
        .checked_add(1)
        .ok_or(WashError::Overflow)?;

    let expiry_model_time = pool
        .model_time
        .checked_add(term)
        .ok_or(WashError::Overflow)?;
    contract.set_inner(ProtectionContract {
        pool: pool.key(),
        buyer: buyer.key(),
        nonce,
        notional,
        premium,
        start_model_time: pool.model_time,
        expiry_model_time,
        // Знімки на момент купівлі: зміна параметрів захисту й давніші події
        // збитку цього контракту вже не стосуються.
        trigger_bps: protection.trigger_bps,
        loss_index_from: pool.loss_count,
        status: ContractStatus::Active,
        // Значущі лише після врегулювання (T031).
        settled_loss_index: 0,
        payout: 0,
        bump: ctx.bumps.contract,
    });

    emit!(ProtectionBought {
        pool: pool.key(),
        contract: contract.key(),
        buyer: buyer.key(),
        nonce,
        notional,
        premium,
        expiry_model_time,
    });
    Ok(())
}
