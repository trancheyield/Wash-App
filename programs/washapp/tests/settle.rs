// `settle_protection` and `expire_protection` (T031, SC-004): the payout follows
// the contract rule, a contract settles once, losses below the trigger and outside
// the term are refused, and expiry returns the reserve to the sellers.
mod common;

use common::{
    assert_pool_invariant, assert_protection_invariant, ata, buy_protection, contract_state,
    deposit, expire_protection, fund_user, loss_event_state, open_tranche_atas, pda, pool_state,
    protection_session, protection_state, provide_protection, record_loss, seed_protection_rates,
    settle_protection, token_amount, withdraw_protection, ConfigSetup, PoolSetup, ProtectionSetup,
    Session, GENESIS_TS, OPERATOR, USER_A, USER_B,
};
use mollusk_svm::result::Check;
use solana_pubkey::Pubkey;
use washapp::math::Tranche;
use washapp::state::ContractStatus;

const FUNDS: u64 = 10_000_000_000;
const JUNIOR: u64 = 1_000_000_000;
const SENIOR: u64 = 3_000_000_000;
const COLLATERAL: u64 = 5_000_000_000;
const NOTIONAL: u64 = 1_000_000_000;
// The term is 30 model days; at the demo pool's `time_scale` that is 60 chain seconds.
const TERM: u64 = 30 * 86_400;
// 1,000 tokens at 2 % a year for 30 model days; the fee is 10 % of the premium.
const PREMIUM: u64 = 1_643_835;
const NET: u64 = PREMIUM - PREMIUM / 10;
// The demo loss of `fixtures/params.json`: 15 % of the pool; the trigger is 1 %.
const LOSS_BPS: u16 = 1_500;
const PAYOUT: u64 = NOTIONAL / 10_000 * LOSS_BPS as u64;

fn has_log(session: &Session, needle: &str) -> bool {
    session.logs().iter().any(|l| l.contains(needle))
}

fn wallet(session: &Session, s: &ConfigSetup, owner: &Pubkey) -> u64 {
    token_amount(&session.snapshot(), &ata(owner, &s.mint))
}

fn contract_at(p: &PoolSetup, buyer: &Pubkey, nonce: u64) -> Pubkey {
    pda::contract(&p.pool, buyer, nonce).0
}

// A market with assets: USER_A filled both tranches (without assets `record_loss`
// refuses with `ZeroAmount`) and sold collateral, USER_B can pay the premium.
// The clock stands at +60 chain seconds, that is 30 model days.
fn market() -> (Session, ConfigSetup, PoolSetup, ProtectionSetup) {
    let (mut session, s, p, pr) = protection_session();
    fund_user(&mut session, &s, USER_A, FUNDS);
    fund_user(&mut session, &s, USER_B, FUNDS);
    open_tranche_atas(&mut session, &p, USER_A);
    session.run(
        &deposit(&s, &p, USER_A, Tranche::Junior, JUNIOR),
        &[Check::success()],
    );
    session.run(
        &deposit(&s, &p, USER_A, Tranche::Senior, SENIOR),
        &[Check::success()],
    );
    session.run(
        &provide_protection(&s, &p, &pr, USER_A, COLLATERAL),
        &[Check::success()],
    );
    session.harness.warp(2, GENESIS_TS + 60);
    (session, s, p, pr)
}

// The market with a contract bought under nonce 0 — where most tests start.
fn covered() -> (Session, ConfigSetup, PoolSetup, ProtectionSetup) {
    let (mut session, s, p, pr) = market();
    session.run(
        &buy_protection(&s, &p, &pr, USER_B, NOTIONAL, TERM, 0),
        &[Check::success()],
    );
    (session, s, p, pr)
}

// SC-004: the payout is notional × the loss share, in one confirmation; the reserve
// is released in full and whatever was not paid out stays with the sellers.
#[test]
fn settle_pays_the_loss_share_of_the_notional_and_frees_the_reserve() {
    let (mut session, s, p, pr) = covered();
    session.run(
        &record_loss(&session, &s, &p, OPERATOR, LOSS_BPS),
        &[Check::success()],
    );
    let event = loss_event_state(&session.snapshot(), &pda::loss_event(&p.pool, 0).0);
    assert_eq!(event.loss_bps, LOSS_BPS);

    let before = wallet(&session, &s, &USER_B);
    session.run(
        &settle_protection(&s, &p, &pr, USER_B, 0, 0),
        &[Check::success()],
    );
    let after = session.snapshot();

    assert_eq!(wallet(&session, &s, &USER_B), before + PAYOUT);
    assert_eq!(PAYOUT, 150_000_000);
    assert_eq!(token_amount(&after, &pr.pvault), COLLATERAL + NET - PAYOUT);

    let protection = protection_state(&after, &pr.protection);
    assert_eq!(protection.collateral, COLLATERAL + NET - PAYOUT);
    assert_eq!(protection.reserved, 0);
    // The seller's shares did not change — the share itself got cheaper.
    assert_eq!(protection.share_supply, COLLATERAL);

    let contract = contract_state(&after, &contract_at(&p, &USER_B, 0));
    assert_eq!(contract.status, ContractStatus::Settled);
    assert_eq!(contract.payout, PAYOUT);
    assert_eq!(contract.settled_loss_index, 0);
    assert_eq!(contract.notional, NOTIONAL);
    assert_pool_invariant(&after, &p.pool);
    assert_protection_invariant(&after, &pr.protection);
}

// SC-004: the same contract never settles twice — neither on the same event nor on
// the next one; a closed contract cannot be closed by expiry either.
#[test]
fn settling_a_closed_contract_is_always_refused() {
    let (mut session, s, p, pr) = covered();
    session.run(
        &record_loss(&session, &s, &p, OPERATOR, LOSS_BPS),
        &[Check::success()],
    );
    session.run(
        &settle_protection(&s, &p, &pr, USER_B, 0, 0),
        &[Check::success()],
    );
    let paid = wallet(&session, &s, &USER_B);

    for attempt in 0..2 {
        // A second loss event — the same contract is already closed.
        if attempt == 1 {
            session.run(
                &record_loss(&session, &s, &p, OPERATOR, LOSS_BPS),
                &[Check::success()],
            );
        }
        let result = session.run(&settle_protection(&s, &p, &pr, USER_B, 0, attempt), &[]);
        assert!(result.raw_result.is_err());
        assert!(has_log(&session, "ContractNotActive"));
    }
    // Expiry does not close a settled contract either.
    session.harness.warp(3, GENESIS_TS + 120);
    let result = session.run(&expire_protection(&s, &p, &pr, USER_B, 0, USER_B), &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "ContractNotActive"));

    let after = session.snapshot();
    assert_eq!(wallet(&session, &s, &USER_B), paid);
    assert_eq!(protection_state(&after, &pr.protection).reserved, 0);
    assert_eq!(
        contract_state(&after, &contract_at(&p, &USER_B, 0)).payout,
        PAYOUT
    );
    assert_protection_invariant(&after, &pr.protection);
}

// A loss below the trigger leaves the contract alone: it stays active and waits for
// an event that does cross the trigger.
#[test]
fn loss_below_the_trigger_leaves_the_contract_active() {
    let (mut session, s, p, pr) = covered();
    // The demo contract triggers at 1 %; half a percent does not cross it.
    session.run(
        &record_loss(&session, &s, &p, OPERATOR, pr.trigger_bps / 2),
        &[Check::success()],
    );
    let before = wallet(&session, &s, &USER_B);
    let result = session.run(&settle_protection(&s, &p, &pr, USER_B, 0, 0), &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "LossBelowTrigger"));

    let after = session.snapshot();
    assert_eq!(wallet(&session, &s, &USER_B), before);
    assert_eq!(
        contract_state(&after, &contract_at(&p, &USER_B, 0)).status,
        ContractStatus::Active
    );
    let protection = protection_state(&after, &pr.protection);
    assert_eq!(protection.reserved, NOTIONAL);
    assert_eq!(protection.collateral, COLLATERAL + NET);

    // Exactly at the trigger it does fire, and the payout follows that second event.
    session.run(
        &record_loss(&session, &s, &p, OPERATOR, pr.trigger_bps),
        &[Check::success()],
    );
    session.run(
        &settle_protection(&s, &p, &pr, USER_B, 0, 1),
        &[Check::success()],
    );
    let after = session.snapshot();
    let contract = contract_state(&after, &contract_at(&p, &USER_B, 0));
    assert_eq!(contract.settled_loss_index, 1);
    assert_eq!(contract.payout, NOTIONAL / 10_000 * pr.trigger_bps as u64);
    assert_protection_invariant(&after, &pr.protection);
}

// A loss before the purchase and a loss after expiry are both outside the term: the
// first is cut off by the index (`loss_index_from`), the second by model time.
#[test]
fn losses_before_the_purchase_and_after_the_expiry_are_outside_the_term() {
    let (mut session, s, p, pr) = market();
    session.run(
        &record_loss(&session, &s, &p, OPERATOR, LOSS_BPS),
        &[Check::success()],
    );
    session.run(
        &buy_protection(&s, &p, &pr, USER_B, NOTIONAL, TERM, 0),
        &[Check::success()],
    );
    assert_eq!(
        contract_state(&session.snapshot(), &contract_at(&p, &USER_B, 0)).loss_index_from,
        1
    );
    let before = wallet(&session, &s, &USER_B);
    let result = session.run(&settle_protection(&s, &p, &pr, USER_B, 0, 0), &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "LossOutsideTerm"));

    // The clock is past the contract's expiry: event #1 is later than `expiry`.
    session.harness.warp(3, GENESIS_TS + 180);
    session.run(
        &record_loss(&session, &s, &p, OPERATOR, LOSS_BPS),
        &[Check::success()],
    );
    let event = loss_event_state(&session.snapshot(), &pda::loss_event(&p.pool, 1).0);
    let contract = contract_state(&session.snapshot(), &contract_at(&p, &USER_B, 0));
    assert!(event.model_time > contract.expiry_model_time);

    let result = session.run(&settle_protection(&s, &p, &pr, USER_B, 0, 1), &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "LossOutsideTerm"));

    let after = session.snapshot();
    assert_eq!(wallet(&session, &s, &USER_B), before);
    assert_eq!(
        contract_state(&after, &contract_at(&p, &USER_B, 0)).status,
        ContractStatus::Active
    );
    assert_eq!(protection_state(&after, &pr.protection).reserved, NOTIONAL);
    assert_protection_invariant(&after, &pr.protection);
}

// Expiry: `NotExpired` before the term, and after it the reserve is free, the
// collateral is whole and the seller takes the premium home with it (FR-010).
#[test]
fn expire_before_the_term_is_refused_and_after_it_returns_the_premium_to_sellers() {
    let (mut session, s, p, pr) = covered();
    let result = session.run(&expire_protection(&s, &p, &pr, USER_B, 0, USER_B), &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "NotExpired"));
    assert_eq!(
        protection_state(&session.snapshot(), &pr.protection).reserved,
        NOTIONAL
    );

    // +60 chain seconds = 30 more model days: `model_time` lands exactly on `expiry`.
    session.harness.warp(3, GENESIS_TS + 120);
    session.run(
        &expire_protection(&s, &p, &pr, USER_B, 0, USER_B),
        &[Check::success()],
    );
    let after = session.snapshot();
    let contract = contract_state(&after, &contract_at(&p, &USER_B, 0));
    assert_eq!(contract.status, ContractStatus::Expired);
    assert_eq!((contract.payout, contract.settled_loss_index), (0, 0));
    assert_eq!(
        pool_state(&after, &p.pool).model_time,
        contract.expiry_model_time
    );

    let protection = protection_state(&after, &pr.protection);
    assert_eq!(protection.reserved, 0);
    assert_eq!(protection.collateral, COLLATERAL + NET);
    assert_eq!(wallet(&session, &s, &USER_B), FUNDS - PREMIUM);

    // The seller withdraws everything: the collateral plus the net premium.
    session.run(
        &withdraw_protection(&s, &p, &pr, USER_A, COLLATERAL),
        &[Check::success()],
    );
    assert_eq!(wallet(&session, &s, &USER_A), FUNDS - JUNIOR - SENIOR + NET);
    let after = session.snapshot();
    assert_eq!(protection_state(&after, &pr.protection).collateral, 0);
    assert_protection_invariant(&after, &pr.protection);
}

// Only the buyer or the pool operator may close a contract: otherwise a seller would
// extinguish a claim that has not been filed yet right after expiry.
#[test]
fn only_the_buyer_or_the_operator_may_expire_a_contract() {
    let (mut session, s, p, pr) = covered();
    session.harness.warp(3, GENESIS_TS + 120);

    // USER_A sells collateral; they are not a party to the contract.
    let result = session.run(&expire_protection(&s, &p, &pr, USER_B, 0, USER_A), &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "Unauthorized"));
    assert_eq!(
        protection_state(&session.snapshot(), &pr.protection).reserved,
        NOTIONAL
    );

    session.run(
        &expire_protection(&s, &p, &pr, USER_B, 0, OPERATOR),
        &[Check::success()],
    );
    let after = session.snapshot();
    assert_eq!(
        contract_state(&after, &contract_at(&p, &USER_B, 0)).status,
        ContractStatus::Expired
    );
    assert_eq!(protection_state(&after, &pr.protection).reserved, 0);
    assert_protection_invariant(&after, &pr.protection);
}

// A total loss of the pool: the payout is exactly the notional and no more, and the
// sellers' collateral falls by the same amount.
#[test]
fn a_total_loss_pays_exactly_the_notional() {
    let (mut session, s, p, pr) = covered();
    session.run(
        &record_loss(&session, &s, &p, OPERATOR, 10_000),
        &[Check::success()],
    );
    let before = wallet(&session, &s, &USER_B);
    session.run(
        &settle_protection(&s, &p, &pr, USER_B, 0, 0),
        &[Check::success()],
    );
    let after = session.snapshot();

    assert_eq!(wallet(&session, &s, &USER_B), before + NOTIONAL);
    let contract = contract_state(&after, &contract_at(&p, &USER_B, 0));
    assert_eq!(contract.payout, NOTIONAL);
    let protection = protection_state(&after, &pr.protection);
    assert_eq!(protection.collateral, COLLATERAL + NET - NOTIONAL);
    assert_eq!(protection.reserved, 0);
    assert_pool_invariant(&after, &p.pool);
    assert_protection_invariant(&after, &pr.protection);
}

// A payout that rounds down to zero does not close the claim: the contract stays
// active and waits for a bigger loss or for expiry (Pavlo's call).
#[test]
fn a_payout_that_rounds_to_zero_leaves_the_contract_active() {
    let (mut session, s, p, pr) = market();
    // A zero rate is the only way to buy a microscopic notional: otherwise the
    // premium itself rounds to zero and `buy_protection` refuses.
    seed_protection_rates(&mut session, &pr, 0, pr.trigger_bps, pr.premium_fee_bps);
    session.run(
        &buy_protection(&s, &p, &pr, USER_B, 6, TERM, 0),
        &[Check::success()],
    );
    session.run(
        &record_loss(&session, &s, &p, OPERATOR, LOSS_BPS),
        &[Check::success()],
    );

    let result = session.run(&settle_protection(&s, &p, &pr, USER_B, 0, 0), &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "ZeroAmount"));

    let after = session.snapshot();
    assert_eq!(wallet(&session, &s, &USER_B), FUNDS);
    let contract = contract_state(&after, &contract_at(&p, &USER_B, 0));
    assert_eq!(contract.status, ContractStatus::Active);
    assert_eq!((contract.payout, contract.notional), (0, 6));
    assert_eq!(protection_state(&after, &pr.protection).reserved, 6);
    assert_protection_invariant(&after, &pr.protection);
}

// A foreign payout account and a contract that does not exist are both refused on
// the account layout, before any arithmetic.
#[test]
fn a_foreign_payout_account_or_a_missing_contract_is_refused() {
    let (mut session, s, p, pr) = covered();
    session.run(
        &record_loss(&session, &s, &p, OPERATOR, LOSS_BPS),
        &[Check::success()],
    );

    // The payout aimed at the seller's wallet instead of the buyer's.
    let mut forged = settle_protection(&s, &p, &pr, USER_B, 0, 0);
    forged.accounts[5].pubkey = ata(&USER_A, &s.mint);
    let result = session.run(&forged, &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "ConstraintTokenOwner"));

    // A contract under a different buyer — no such account exists.
    let result = session.run(&settle_protection(&s, &p, &pr, USER_A, 0, 0), &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "AccountNotInitialized"));

    let after = session.snapshot();
    assert_eq!(
        contract_state(&after, &contract_at(&p, &USER_B, 0)).status,
        ContractStatus::Active
    );
    assert_eq!(protection_state(&after, &pr.protection).reserved, NOTIONAL);
    assert_protection_invariant(&after, &pr.protection);
}
