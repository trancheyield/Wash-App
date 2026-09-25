use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::WashError;
use crate::events::ProtectionSettled;
use crate::math;
use crate::state::{ContractStatus, LossEvent, Pool, ProtectionContract, ProtectionPool};

// No `accrue` here: the loss event carries its own model time and the term was
// snapshotted when the contract was bought, so the pool clock has no say. That
// keeps the frame narrow (seven accounts instead of the full pool layout) and
// lets a claim be settled even after expiry, as long as the event happened
// inside the term.
#[derive(Accounts)]
pub struct SettleProtection<'info> {
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
    // `has_one` pins both the contract and the event to this pool; the program
    // wrote both accounts itself, so their remaining fields are authentic
    // without a seeds check that would cost frame.
    #[account(mut, has_one = pool)]
    pub contract: Account<'info, ProtectionContract>,
    #[account(has_one = pool)]
    pub loss_event: Account<'info, LossEvent>,
    // The payout only ever reaches the buyer's token account: anyone may settle
    // the contract, but the money still goes to its owner.
    #[account(mut, token::mint = pool.mint, token::authority = contract.buyer)]
    pub buyer_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn settle_protection_handler(ctx: Context<SettleProtection>) -> Result<()> {
    let SettleProtection {
        pool,
        protection,
        pvault,
        contract,
        loss_event,
        buyer_ata,
        token_program,
    } = &mut *ctx.accounts;
    require!(
        contract.status == ContractStatus::Active,
        WashError::ContractNotActive
    );
    // A loss before the purchase is not a covered event. Event indexes grow
    // together with model time, so the index guards the lower bound of the term
    // and `model_time` the upper one.
    require!(
        loss_event.index >= contract.loss_index_from,
        WashError::LossOutsideTerm
    );
    require!(
        loss_event.model_time <= contract.expiry_model_time,
        WashError::LossOutsideTerm
    );
    // The trigger is a snapshot taken at purchase: later changes to the
    // protection parameters leave this contract alone.
    require!(
        loss_event.loss_bps >= contract.trigger_bps,
        WashError::LossBelowTrigger
    );

    let payout = math::payout(contract.notional, loss_event.loss_bps)?;
    // A payout that rounds down to zero is not worth the claim: the contract
    // stays active and waits for a bigger loss or for expiry (Pavlo's call).
    require!(payout > 0, WashError::ZeroAmount);

    let pool_key = pool.key();
    let bump = [protection.bump];
    let signer: &[&[&[u8]]] = &[&[ProtectionPool::SEED, pool_key.as_ref(), &bump]];
    token::transfer(
        CpiContext::new_with_signer(
            token_program.key(),
            Transfer {
                from: pvault.to_account_info(),
                to: buyer_ata.to_account_info(),
                authority: protection.to_account_info(),
            },
            signer,
        ),
        payout,
    )?;

    protection.collateral = protection
        .collateral
        .checked_sub(payout)
        .ok_or(WashError::Overflow)?;
    // The reserve is released in full: whatever was not paid out goes back to
    // the sellers.
    protection.reserved = protection
        .reserved
        .checked_sub(contract.notional)
        .ok_or(WashError::Overflow)?;

    contract.status = ContractStatus::Settled;
    contract.settled_loss_index = loss_event.index;
    contract.payout = payout;

    emit!(ProtectionSettled {
        pool: pool_key,
        contract: contract.key(),
        loss_index: loss_event.index,
        payout,
    });
    Ok(())
}
