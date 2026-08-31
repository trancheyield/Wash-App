mod common;

use common::{
    accrue, assert_pool_invariant, ata, deposit, fund_user, mint_supply, open_tranche_atas,
    pool_session, pool_state, seed_pool_balances, seed_pool_state, token_amount, Session,
    GENESIS_TS, USER_A, USER_B,
};
use mollusk_svm::result::Check;
use washapp::math::{PoolBalances, Tranche};

const SENIOR: u64 = 75_000_000_000;
const JUNIOR: u64 = 25_000_000_000;

fn has_log(session: &Session, needle: &str) -> bool {
    session.logs().iter().any(|l| l.contains(needle))
}

// Перший вкладник кожного траншу отримує частки 1:1; junior іде першим, бо
// senior у порожній пул порушив би мінімум junior.
#[test]
fn first_deposits_mint_shares_one_to_one() {
    let (mut session, s, p) = pool_session();
    fund_user(&mut session, &s, USER_A, SENIOR + JUNIOR);
    open_tranche_atas(&mut session, &p, USER_A);

    session.run(
        &deposit(&s, &p, USER_A, Tranche::Junior, JUNIOR),
        &[Check::success()],
    );
    session.run(
        &deposit(&s, &p, USER_A, Tranche::Senior, SENIOR),
        &[Check::success()],
    );
    let after = session.snapshot();

    let pool = pool_state(&after, &p.pool);
    assert_eq!(pool.senior_assets, SENIOR);
    assert_eq!(pool.junior_assets, JUNIOR);
    assert_eq!(pool.assets, SENIOR + JUNIOR);
    assert_eq!(token_amount(&after, &p.vault), SENIOR + JUNIOR);
    assert_eq!(token_amount(&after, &ata(&USER_A, &s.mint)), 0);
    assert_eq!(token_amount(&after, &ata(&USER_A, &p.senior_mint)), SENIOR);
    assert_eq!(token_amount(&after, &ata(&USER_A, &p.junior_mint)), JUNIOR);
    assert_eq!(mint_supply(&after, &p.senior_mint), SENIOR);
    assert_eq!(mint_supply(&after, &p.junior_mint), JUNIOR);
    assert_pool_invariant(&after, &p.pool);
}

#[test]
fn senior_into_empty_pool_is_refused_by_the_junior_floor() {
    let (mut session, s, p) = pool_session();
    fund_user(&mut session, &s, USER_A, SENIOR);
    open_tranche_atas(&mut session, &p, USER_A);
    let result = session.run(&deposit(&s, &p, USER_A, Tranche::Senior, SENIOR), &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "SubordinationBreached"));
    assert_eq!(pool_state(&session.snapshot(), &p.pool).assets, 0);
}

// Другий вкладник після 30 модельних днів платить за NAV: 10 000 WUSD у junior
// з активами 25 283,56 і supply 25 000 → 9 887,85 jWUSD.
#[test]
fn second_deposit_is_priced_at_nav_after_accrual() {
    let (mut session, s, p) = pool_session();
    seed_pool_balances(&mut session, &p, SENIOR, JUNIOR);
    fund_user(&mut session, &s, USER_B, 10_000_000_000);
    open_tranche_atas(&mut session, &p, USER_B);
    session.harness.warp(2, GENESIS_TS + 60);

    // accrue всередині deposit — окремий crank перед ним нічого не змінює.
    session.run(
        &deposit(&s, &p, USER_B, Tranche::Junior, 10_000_000_000),
        &[Check::success()],
    );
    let after = session.snapshot();

    let pool = pool_state(&after, &p.pool);
    assert_eq!(pool.senior_assets, 75_308_219_178);
    assert_eq!(pool.junior_assets, 25_283_561_644 + 10_000_000_000);
    assert_eq!(
        token_amount(&after, &ata(&USER_B, &p.junior_mint)),
        9_887_847_429
    );
    assert_eq!(mint_supply(&after, &p.junior_mint), JUNIOR + 9_887_847_429);
    assert_eq!(token_amount(&after, &s.treasury), 65_753_424);
    assert_pool_invariant(&after, &p.pool);

    // Явний crank у тій самій секунді після депозиту — нуль змін.
    session.run(&accrue(&s, &p), &[Check::success()]);
    assert_eq!(pool_state(&session.snapshot(), &p.pool).assets, pool.assets);
}

// Рядок брифу M0: після 30 днів senior-депозит 25 000 лишає junior 20,13 % —
// дозволено; 26 000 дав би 19,97 % — відмова до підпису.
#[test]
fn senior_deposit_above_the_junior_floor_is_refused() {
    let (mut session, s, p) = pool_session();
    seed_pool_balances(&mut session, &p, SENIOR, JUNIOR);
    fund_user(&mut session, &s, USER_B, 60_000_000_000);
    open_tranche_atas(&mut session, &p, USER_B);
    session.harness.warp(2, GENESIS_TS + 60);
    session.run(&accrue(&s, &p), &[Check::success()]);

    let refused = session.run(
        &deposit(&s, &p, USER_B, Tranche::Senior, 26_000_000_000),
        &[],
    );
    assert!(refused.raw_result.is_err());
    assert!(has_log(&session, "SubordinationBreached"));
    assert_eq!(token_amount(&session.snapshot(), &p.vault), 100_591_780_822);

    session.run(
        &deposit(&s, &p, USER_B, Tranche::Senior, 25_000_000_000),
        &[Check::success()],
    );
    let after = session.snapshot();
    let pool = pool_state(&after, &p.pool);
    assert_eq!(pool.senior_assets, 75_308_219_178 + 25_000_000_000);
    // Частки за NAV 1,004110: менше, ніж внесено.
    let shares = token_amount(&after, &ata(&USER_B, &p.senior_mint));
    assert!(shares < 25_000_000_000 && shares > 24_800_000_000);
    assert_pool_invariant(&after, &p.pool);
}

// Junior-депозит обмежень не має: він лише збільшує подушку.
#[test]
fn junior_deposit_has_no_floor() {
    let (mut session, s, p) = pool_session();
    seed_pool_balances(&mut session, &p, SENIOR, JUNIOR);
    fund_user(&mut session, &s, USER_B, 1);
    open_tranche_atas(&mut session, &p, USER_B);
    session.run(
        &deposit(&s, &p, USER_B, Tranche::Junior, 1),
        &[Check::success()],
    );
    assert_pool_invariant(&session.snapshot(), &p.pool);
}

// Транш, вичерпаний збитком: частки є, активів немає — новий внесок ділився б
// зі старими держателями, тому відмова.
#[test]
fn deposit_into_wiped_out_tranche_is_refused() {
    let (mut session, s, p) = pool_session();
    seed_pool_state(
        &mut session,
        &p,
        &PoolBalances {
            assets: SENIOR,
            senior_assets: SENIOR,
            junior_assets: 0,
            senior_supply: SENIOR,
            junior_supply: JUNIOR,
        },
    );
    fund_user(&mut session, &s, USER_B, 1_000_000);
    open_tranche_atas(&mut session, &p, USER_B);
    let result = session.run(&deposit(&s, &p, USER_B, Tranche::Junior, 1_000_000), &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "TrancheWipedOut"));
}

#[test]
fn deposit_of_zero_or_dust_is_refused() {
    let (mut session, s, p) = pool_session();
    seed_pool_balances(&mut session, &p, SENIOR, JUNIOR);
    fund_user(&mut session, &s, USER_B, 10);
    open_tranche_atas(&mut session, &p, USER_B);

    let zero = session.run(&deposit(&s, &p, USER_B, Tranche::Junior, 0), &[]);
    assert!(zero.raw_result.is_err());
    assert!(has_log(&session, "ZeroAmount"));

    // Після доходу NAV > 1: одна мікроодиниця дає нуль часток.
    session.harness.warp(2, GENESIS_TS + 60);
    let dust = session.run(&deposit(&s, &p, USER_B, Tranche::Junior, 1), &[]);
    assert!(dust.raw_result.is_err());
    assert!(has_log(&session, "ZeroAmount"));
    assert_eq!(
        token_amount(&session.snapshot(), &ata(&USER_B, &s.mint)),
        10
    );
}

#[test]
fn deposit_beyond_balance_is_refused_by_spl_token() {
    let (mut session, s, p) = pool_session();
    fund_user(&mut session, &s, USER_A, 100);
    open_tranche_atas(&mut session, &p, USER_A);
    let result = session.run(&deposit(&s, &p, USER_A, Tranche::Junior, 101), &[]);
    assert!(result.raw_result.is_err());
    assert_eq!(pool_state(&session.snapshot(), &p.pool).assets, 0);
}

// ATA траншу в акаунтах не того мінта, що обраний транш — відмова до CPI.
#[test]
fn deposit_with_mismatched_tranche_ata_is_refused() {
    let (mut session, s, p) = pool_session();
    fund_user(&mut session, &s, USER_A, JUNIOR);
    open_tranche_atas(&mut session, &p, USER_A);
    let mut swapped = deposit(&s, &p, USER_A, Tranche::Junior, JUNIOR);
    let junior_ata = ata(&USER_A, &p.junior_mint);
    let idx = swapped
        .accounts
        .iter()
        .position(|m| m.pubkey == junior_ata)
        .unwrap();
    swapped.accounts[idx].pubkey = ata(&USER_A, &p.senior_mint);
    let result = session.run(&swapped, &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "ParameterOutOfRange"));
    assert_eq!(pool_state(&session.snapshot(), &p.pool).assets, 0);
}

// ATA траншу ще не відкрито — програма її не створює, клієнт має зробити це сам.
#[test]
fn deposit_without_tranche_ata_is_refused() {
    let (mut session, s, p) = pool_session();
    fund_user(&mut session, &s, USER_A, JUNIOR);
    let result = session.run(&deposit(&s, &p, USER_A, Tranche::Junior, JUNIOR), &[]);
    assert!(result.raw_result.is_err());
    assert_eq!(pool_state(&session.snapshot(), &p.pool).assets, 0);
}
