// `init_protection` / `provide_protection` / `withdraw_protection` (T029):
// створення захисного пулу, частки продавців 1:1 і за вартістю, вивід лише
// вільної частини, ролі, інваріант pvault.
mod common;

use common::{
    account_of, assert_protection_invariant, ata, fund_user, init_protection, pda, pool_session,
    protection_session, protection_setup, protection_state, provide_protection,
    seed_protection_state, seller_state, token_amount, withdraw_protection, ConfigSetup, PoolSetup,
    ProtectionSetup, Session, OPERATOR, USER_A, USER_B,
};
use mollusk_svm::result::Check;
use solana_program_pack::Pack;
use solana_pubkey::Pubkey;
use spl_token_interface::state::Account as TokenAccount;

const FUNDS: u64 = 10_000_000_000;
const FIRST: u64 = 1_000_000_000;
// Премія, що падає в pvault між внесками двох продавців, — без нових часток.
const PREMIUM: u64 = 100_000_000;

fn has_log(session: &Session, needle: &str) -> bool {
    session.logs().iter().any(|l| l.contains(needle))
}

fn seller_shares(session: &Session, p: &PoolSetup, owner: &Pubkey) -> u64 {
    let key = pda::seller(&p.pool, owner).0;
    seller_state(&[(key, session.get(&key))], &key).shares
}

fn wallet(session: &Session, s: &ConfigSetup, owner: &Pubkey) -> u64 {
    token_amount(&session.snapshot(), &ata(owner, &s.mint))
}

// Два продавці з базовим токеном — старт для provide/withdraw.
fn funded_sellers() -> (Session, ConfigSetup, PoolSetup, ProtectionSetup) {
    let (mut session, s, p, pr) = protection_session();
    fund_user(&mut session, &s, USER_A, FUNDS);
    fund_user(&mut session, &s, USER_B, FUNDS);
    (session, s, p, pr)
}

#[test]
fn init_protection_creates_pool_and_pvault_with_demo_params() {
    let (session, _s, p, pr) = protection_session();
    let after = session.snapshot();

    let protection = protection_state(&after, &pr.protection);
    assert_eq!(protection.pool, p.pool);
    assert_eq!(protection.pvault, pr.pvault);
    // Числа брифу M0: 2 % річних, поріг 1 %, комісія 10 % з премії.
    assert_eq!(protection.premium_rate_bps, 200);
    assert_eq!(protection.trigger_bps, 100);
    assert_eq!(protection.premium_fee_bps, 1_000);
    assert_eq!(
        (
            protection.collateral,
            protection.reserved,
            protection.share_supply,
            protection.contracts
        ),
        (0, 0, 0, 0)
    );
    assert_eq!(protection.bump, pr.bump);

    // pvault — токен-акаунт демо-мінта під підписом захисного пулу.
    let pvault = TokenAccount::unpack(&account_of(&after, &pr.pvault).data).unwrap();
    assert_eq!(pvault.mint, pda::mint().0);
    assert_eq!(pvault.owner, pr.protection);
    assert_eq!(pvault.amount, 0);
    assert_protection_invariant(&after, &pr.protection);
}

#[test]
fn init_protection_by_stranger_is_unauthorized() {
    let (mut session, s, p) = pool_session();
    let pr = protection_setup(&p);
    session.set(USER_A, common::signer_account());
    let result = session.run(&init_protection(&s, &p, &pr, USER_A), &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "Unauthorized"));
    assert!(session.get(&pr.protection).data.is_empty());
}

#[test]
fn init_protection_rejects_rates_over_100_percent_and_a_second_init() {
    let (mut session, s, p) = pool_session();
    for (rate, trigger, fee) in [
        (10_001, 100, 1_000),
        (200, 10_001, 1_000),
        (200, 100, 10_001),
    ] {
        let pr = ProtectionSetup {
            premium_rate_bps: rate,
            trigger_bps: trigger,
            premium_fee_bps: fee,
            ..protection_setup(&p)
        };
        let result = session.run(&init_protection(&s, &p, &pr, OPERATOR), &[]);
        assert!(result.raw_result.is_err());
        assert!(has_log(&session, "ParameterOutOfRange"));
    }
    // Стелі включно: 100 % — дозволене значення.
    let pr = ProtectionSetup {
        premium_rate_bps: 10_000,
        trigger_bps: 10_000,
        premium_fee_bps: 10_000,
        ..protection_setup(&p)
    };
    session.run(&init_protection(&s, &p, &pr, OPERATOR), &[Check::success()]);
    // Другий раз — PDA вже існує, `init` відмовляє.
    let result = session.run(&init_protection(&s, &p, &pr, OPERATOR), &[]);
    assert!(result.raw_result.is_err());
}

#[test]
fn first_seller_gets_shares_one_to_one() {
    let (mut session, s, p, pr) = funded_sellers();
    session.run(
        &provide_protection(&s, &p, &pr, USER_A, FIRST),
        &[Check::success()],
    );
    let after = session.snapshot();

    let protection = protection_state(&after, &pr.protection);
    assert_eq!(protection.collateral, FIRST);
    assert_eq!(protection.share_supply, FIRST);
    assert_eq!(protection.reserved, 0);
    assert_eq!(token_amount(&after, &pr.pvault), FIRST);
    assert_eq!(wallet(&session, &s, &USER_A), FUNDS - FIRST);

    let (key, bump) = pda::seller(&p.pool, &USER_A);
    let position = seller_state(&after, &key);
    assert_eq!(position.pool, p.pool);
    assert_eq!(position.owner, USER_A);
    assert_eq!(position.shares, FIRST);
    assert_eq!(position.bump, bump);
    assert_protection_invariant(&after, &pr.protection);
}

// Повторний внесок того самого продавця — одна позиція, частки додаються.
#[test]
fn repeated_provide_accumulates_in_one_position() {
    let (mut session, s, p, pr) = funded_sellers();
    for _ in 0..2 {
        session.run(
            &provide_protection(&s, &p, &pr, USER_A, FIRST),
            &[Check::success()],
        );
    }
    assert_eq!(seller_shares(&session, &p, &USER_A), 2 * FIRST);
    let protection = protection_state(&session.snapshot(), &pr.protection);
    assert_eq!(protection.collateral, 2 * FIRST);
    assert_eq!(protection.share_supply, 2 * FIRST);
    assert_protection_invariant(&session.snapshot(), &pr.protection);
}

// Два продавці: премія між внесками підняла ціну частки, другий отримує
// пропорційно менше; вихід першого забирає його частку премії.
#[test]
fn second_seller_gets_shares_by_value_and_each_exits_pro_rata() {
    let (mut session, s, p, pr) = funded_sellers();
    session.run(
        &provide_protection(&s, &p, &pr, USER_A, FIRST),
        &[Check::success()],
    );
    seed_protection_state(&mut session, &pr, FIRST + PREMIUM, 0, FIRST);
    let second = FIRST + PREMIUM;
    session.run(
        &provide_protection(&s, &p, &pr, USER_B, second),
        &[Check::success()],
    );
    // 1 100 × 1 000 / 1 100 = 1 000 часток за 1 100 токенів.
    assert_eq!(seller_shares(&session, &p, &USER_B), FIRST);
    let protection = protection_state(&session.snapshot(), &pr.protection);
    assert_eq!(protection.collateral, 2 * FIRST + 2 * PREMIUM);
    assert_eq!(protection.share_supply, 2 * FIRST);

    session.run(
        &withdraw_protection(&s, &p, &pr, USER_A, FIRST),
        &[Check::success()],
    );
    let after = session.snapshot();
    assert_eq!(wallet(&session, &s, &USER_A), FUNDS + PREMIUM);
    assert_eq!(seller_shares(&session, &p, &USER_A), 0);
    let protection = protection_state(&after, &pr.protection);
    assert_eq!(protection.collateral, FIRST + PREMIUM);
    assert_eq!(protection.share_supply, FIRST);
    assert_protection_invariant(&after, &pr.protection);

    session.run(
        &withdraw_protection(&s, &p, &pr, USER_B, FIRST),
        &[Check::success()],
    );
    let after = session.snapshot();
    assert_eq!(wallet(&session, &s, &USER_B), FUNDS);
    let protection = protection_state(&after, &pr.protection);
    assert_eq!((protection.collateral, protection.share_supply), (0, 0));
    assert_protection_invariant(&after, &pr.protection);
}

#[test]
fn withdraw_beyond_free_collateral_is_refused() {
    let (mut session, s, p, pr) = funded_sellers();
    session.run(
        &provide_protection(&s, &p, &pr, USER_A, FIRST),
        &[Check::success()],
    );
    // Зарезервовано 70 %: вивести можна не більше за 30 %.
    let reserved = FIRST * 7 / 10;
    seed_protection_state(&mut session, &pr, FIRST, reserved, FIRST);

    let result = session.run(&withdraw_protection(&s, &p, &pr, USER_A, FIRST), &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "InsufficientFreeCollateral"));
    assert_eq!(seller_shares(&session, &p, &USER_A), FIRST);

    let free = FIRST - reserved;
    let result = session.run(&withdraw_protection(&s, &p, &pr, USER_A, free + 1), &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "InsufficientFreeCollateral"));

    session.run(
        &withdraw_protection(&s, &p, &pr, USER_A, free),
        &[Check::success()],
    );
    let after = session.snapshot();
    let protection = protection_state(&after, &pr.protection);
    assert_eq!(protection.collateral, reserved);
    assert_eq!(protection.reserved, reserved);
    assert_eq!(seller_shares(&session, &p, &USER_A), reserved);
    assert_eq!(wallet(&session, &s, &USER_A), FUNDS - reserved);
    assert_protection_invariant(&after, &pr.protection);
}

#[test]
fn withdraw_more_than_own_shares_or_zero_is_refused() {
    let (mut session, s, p, pr) = funded_sellers();
    session.run(
        &provide_protection(&s, &p, &pr, USER_A, FIRST),
        &[Check::success()],
    );
    session.run(
        &provide_protection(&s, &p, &pr, USER_B, FIRST),
        &[Check::success()],
    );
    // Часток у пулі вдвічі більше, ніж у продавця, — межа саме його позиція.
    let result = session.run(&withdraw_protection(&s, &p, &pr, USER_A, FIRST + 1), &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "ParameterOutOfRange"));

    let result = session.run(&withdraw_protection(&s, &p, &pr, USER_A, 0), &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "ZeroAmount"));

    let result = session.run(&provide_protection(&s, &p, &pr, USER_A, 0), &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "ZeroAmount"));
    assert_eq!(seller_shares(&session, &p, &USER_A), FIRST);
    assert_protection_invariant(&session.snapshot(), &pr.protection);
}

// Забезпечення, вичерпане виплатами при живих частках, не приймає внесків і
// не віддає нічого за частки — як транш після 100 % збитку.
#[test]
fn wiped_out_collateral_refuses_provide_and_withdraw() {
    let (mut session, s, p, pr) = funded_sellers();
    session.run(
        &provide_protection(&s, &p, &pr, USER_A, FIRST),
        &[Check::success()],
    );
    seed_protection_state(&mut session, &pr, 0, 0, FIRST);

    let result = session.run(&provide_protection(&s, &p, &pr, USER_B, FIRST), &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "CollateralWipedOut"));

    let result = session.run(&withdraw_protection(&s, &p, &pr, USER_A, FIRST), &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "CollateralWipedOut"));
    assert_eq!(seller_shares(&session, &p, &USER_A), FIRST);
}

// Внесок, що округлюється до нуля часток: частка коштує 10, вносять 5.
#[test]
fn provide_that_rounds_to_zero_shares_is_refused() {
    let (mut session, s, p, pr) = funded_sellers();
    session.run(
        &provide_protection(&s, &p, &pr, USER_A, 1),
        &[Check::success()],
    );
    seed_protection_state(&mut session, &pr, 10, 0, 1);
    let result = session.run(&provide_protection(&s, &p, &pr, USER_B, 5), &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "ZeroAmount"));
    assert_eq!(wallet(&session, &s, &USER_B), FUNDS);
}

// Продавець без позиції, чужий pvault, чужа позиція — усе відмовляє на
// розкладці акаунтів, до будь-якої математики.
#[test]
fn withdraw_without_position_or_with_foreign_accounts_is_refused() {
    let (mut session, s, p, pr) = funded_sellers();
    session.run(
        &provide_protection(&s, &p, &pr, USER_A, FIRST),
        &[Check::success()],
    );
    // USER_B позиції не має.
    let result = session.run(&withdraw_protection(&s, &p, &pr, USER_B, 1), &[]);
    assert!(result.raw_result.is_err());

    // USER_B підставляє позицію USER_A.
    let mut forged = withdraw_protection(&s, &p, &pr, USER_B, FIRST);
    forged.accounts[4].pubkey = pda::seller(&p.pool, &USER_A).0;
    let result = session.run(&forged, &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "ConstraintSeeds"));

    // Чужий pvault замість прив'язаного до захисного пулу.
    let mut forged = withdraw_protection(&s, &p, &pr, USER_A, FIRST);
    forged.accounts[2].pubkey = ata(&USER_B, &s.mint);
    let result = session.run(&forged, &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "ConstraintAddress"));

    assert_eq!(seller_shares(&session, &p, &USER_A), FIRST);
    assert_eq!(wallet(&session, &s, &USER_B), FUNDS);
    assert_protection_invariant(&session.snapshot(), &pr.protection);
}

// Без `init_protection` продавцю нікуди вносити: захисного пулу немає.
#[test]
fn provide_before_init_protection_is_refused() {
    let (mut session, s, p) = pool_session();
    let pr = protection_setup(&p);
    fund_user(&mut session, &s, USER_A, FUNDS);
    let result = session.run(&provide_protection(&s, &p, &pr, USER_A, FIRST), &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "AccountNotInitialized"));
    assert_eq!(wallet(&session, &s, &USER_A), FUNDS);
}
