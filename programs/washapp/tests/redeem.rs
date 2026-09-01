mod common;

use common::{
    account_of, accrue, assert_pool_invariant, ata, ata_account, deposit, fund_user, mint_supply,
    open_tranche_atas, pool_session, pool_state, redeem, seed_pool_state, token_amount,
    ConfigSetup, PoolSetup, Session, GENESIS_TS, USER_A, USER_B,
};
use mollusk_svm::result::Check;
use washapp::math::{PoolBalances, Tranche};

const SENIOR: u64 = 75_000_000_000;
const JUNIOR: u64 = 25_000_000_000;

fn has_log(session: &Session, needle: &str) -> bool {
    session.logs().iter().any(|l| l.contains(needle))
}

// Пул брифу M0 через справжні депозити: USER_A тримає обидва транші.
fn funded_pool() -> (Session, ConfigSetup, PoolSetup) {
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
    (session, s, p)
}

#[test]
fn full_redeem_after_yield_returns_nav_and_empties_the_pool() {
    let (mut session, s, p) = funded_pool();
    session.harness.warp(2, GENESIS_TS + 60);

    session.run(
        &redeem(&s, &p, USER_A, Tranche::Senior, SENIOR),
        &[Check::success()],
    );
    let after = session.snapshot();
    let pool = pool_state(&after, &p.pool);
    assert_eq!(pool.senior_assets, 0);
    assert_eq!(pool.junior_assets, 25_283_561_644);
    assert_eq!(mint_supply(&after, &p.senior_mint), 0);
    assert_eq!(token_amount(&after, &ata(&USER_A, &s.mint)), 75_308_219_178);
    assert_pool_invariant(&after, &p.pool);

    session.run(
        &redeem(&s, &p, USER_A, Tranche::Junior, JUNIOR),
        &[Check::success()],
    );
    let after = session.snapshot();
    let pool = pool_state(&after, &p.pool);
    assert_eq!(
        (pool.assets, pool.senior_assets, pool.junior_assets),
        (0, 0, 0)
    );
    assert_eq!(mint_supply(&after, &p.junior_mint), 0);
    assert_eq!(token_amount(&after, &p.vault), 0);
    assert_eq!(
        token_amount(&after, &ata(&USER_A, &s.mint)),
        75_308_219_178 + 25_283_561_644
    );
    // Комісія лишилась у treasury — вкладники отримали net.
    assert_eq!(token_amount(&after, &s.treasury), 65_753_424);
    assert_pool_invariant(&after, &p.pool);
}

#[test]
fn partial_redeem_is_priced_at_nav() {
    let (mut session, s, p) = funded_pool();
    session.harness.warp(2, GENESIS_TS + 60);
    session.run(
        &redeem(&s, &p, USER_A, Tranche::Senior, SENIOR / 2),
        &[Check::success()],
    );
    let after = session.snapshot();
    let pool = pool_state(&after, &p.pool);
    assert_eq!(pool.senior_assets, 75_308_219_178 - 37_654_109_589);
    assert_eq!(mint_supply(&after, &p.senior_mint), SENIOR / 2);
    assert_eq!(
        token_amount(&after, &ata(&USER_A, &p.senior_mint)),
        SENIOR / 2
    );
    assert_eq!(token_amount(&after, &ata(&USER_A, &s.mint)), 37_654_109_589);
    assert_pool_invariant(&after, &p.pool);
}

// US1 acceptance: рівні внески в senior і junior, після періоду з доходом
// junior заробив строго більше.
#[test]
fn equal_deposits_junior_earns_strictly_more_than_senior() {
    let (mut session, s, p) = pool_session();
    let half = 50_000_000_000;
    for user in [USER_A, USER_B] {
        fund_user(&mut session, &s, user, half);
        open_tranche_atas(&mut session, &p, user);
    }
    session.run(
        &deposit(&s, &p, USER_A, Tranche::Junior, half),
        &[Check::success()],
    );
    session.run(
        &deposit(&s, &p, USER_B, Tranche::Senior, half),
        &[Check::success()],
    );
    session.harness.warp(2, GENESIS_TS + 60);

    session.run(
        &redeem(&s, &p, USER_B, Tranche::Senior, half),
        &[Check::success()],
    );
    session.run(
        &redeem(&s, &p, USER_A, Tranche::Junior, half),
        &[Check::success()],
    );
    let after = session.snapshot();
    let junior_got = token_amount(&after, &ata(&USER_A, &s.mint));
    let senior_got = token_amount(&after, &ata(&USER_B, &s.mint));
    assert_eq!(senior_got, half + 205_479_452);
    assert_eq!(junior_got, half + 386_301_370);
    assert!(junior_got > senior_got);
    assert_pool_invariant(&after, &p.pool);
}

// Депозит і негайне погашення повертають не більше внесеного: обидва ділення —
// вниз, залишок округлення лишається в пулі.
#[test]
fn deposit_then_immediate_redeem_never_returns_more_than_deposited() {
    let (mut session, s, p) = funded_pool();
    session.harness.warp(2, GENESIS_TS + 60);
    session.run(&accrue(&s, &p), &[Check::success()]);
    fund_user(&mut session, &s, USER_B, 10_000_000_000);
    open_tranche_atas(&mut session, &p, USER_B);

    session.run(
        &deposit(&s, &p, USER_B, Tranche::Junior, 10_000_000_000),
        &[Check::success()],
    );
    let shares = token_amount(&session.snapshot(), &ata(&USER_B, &p.junior_mint));
    assert_eq!(shares, 9_887_847_429);
    session.run(
        &redeem(&s, &p, USER_B, Tranche::Junior, shares),
        &[Check::success()],
    );
    let after = session.snapshot();
    assert_eq!(token_amount(&after, &ata(&USER_B, &s.mint)), 9_999_999_999);
    assert_pool_invariant(&after, &p.pool);
}

#[test]
fn redeem_beyond_balance_or_supply_is_refused() {
    let (mut session, s, p) = funded_pool();
    fund_user(&mut session, &s, USER_B, 10_000_000_000);
    open_tranche_atas(&mut session, &p, USER_B);
    session.run(
        &deposit(&s, &p, USER_B, Tranche::Junior, 10_000_000_000),
        &[Check::success()],
    );
    let before = account_of(&session.snapshot(), &p.pool).data.clone();

    // Понад власний баланс, але в межах supply — відмовляє SPL Token на burn.
    let over_balance = session.run(
        &redeem(&s, &p, USER_B, Tranche::Junior, 10_000_000_001),
        &[],
    );
    assert!(over_balance.raw_result.is_err());

    // Понад supply — відмовляє математика до будь-якого CPI.
    let over_supply = session.run(
        &redeem(&s, &p, USER_B, Tranche::Junior, JUNIOR + 10_000_000_001),
        &[],
    );
    assert!(over_supply.raw_result.is_err());
    assert!(has_log(&session, "ParameterOutOfRange"));

    assert_eq!(account_of(&session.snapshot(), &p.pool).data, before);
}

// Junior-погашення, після якого подушка впала б нижче 20 %: 6 250 з 25 000
// лишає рівно 20 % — дозволено; на одиницю більше — відмова.
#[test]
fn junior_redeem_below_the_floor_is_refused() {
    let (mut session, s, p) = funded_pool();
    let edge = 6_250_000_000;

    let refused = session.run(&redeem(&s, &p, USER_A, Tranche::Junior, edge + 1), &[]);
    assert!(refused.raw_result.is_err());
    assert!(has_log(&session, "SubordinationBreached"));
    assert_eq!(
        pool_state(&session.snapshot(), &p.pool).junior_assets,
        JUNIOR
    );

    session.run(
        &redeem(&s, &p, USER_A, Tranche::Junior, edge),
        &[Check::success()],
    );
    let after = session.snapshot();
    assert_eq!(pool_state(&after, &p.pool).junior_assets, JUNIOR - edge);
    assert_pool_invariant(&after, &p.pool);
}

// Senior-погашення обмежень не має — навіть до нуля при будь-якому junior.
#[test]
fn senior_redeem_has_no_floor() {
    let (mut session, s, p) = funded_pool();
    session.run(
        &redeem(&s, &p, USER_A, Tranche::Senior, SENIOR),
        &[Check::success()],
    );
    let after = session.snapshot();
    let pool = pool_state(&after, &p.pool);
    assert_eq!((pool.senior_assets, pool.junior_assets), (0, JUNIOR));
    assert_pool_invariant(&after, &p.pool);

    // Тепер junior — увесь пул, і його можна забрати цілком: порожній пул
    // мінімуму не порушує.
    session.run(
        &redeem(&s, &p, USER_A, Tranche::Junior, JUNIOR),
        &[Check::success()],
    );
    assert_eq!(pool_state(&session.snapshot(), &p.pool).assets, 0);
}

// Стан після збитку: частки є, активів у траншу немає або лишились крихти.
#[test]
fn redeem_from_wiped_out_or_dust_tranche_is_refused() {
    let (mut session, s, p) = pool_session();
    fund_user(&mut session, &s, USER_B, 1);
    let (key, account) = ata_account(USER_B, p.junior_mint, JUNIOR);
    session.set(key, account);
    open_tranche_atas(&mut session, &p, USER_B);

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
    let wiped = session.run(&redeem(&s, &p, USER_B, Tranche::Junior, 1_000), &[]);
    assert!(wiped.raw_result.is_err());
    assert!(has_log(&session, "TrancheWipedOut"));

    // Один мікро-WUSD на 25 000 часток: 1 000 часток коштують нуль.
    seed_pool_state(
        &mut session,
        &p,
        &PoolBalances {
            assets: SENIOR + 1,
            senior_assets: SENIOR,
            junior_assets: 1,
            senior_supply: SENIOR,
            junior_supply: JUNIOR,
        },
    );
    let dust = session.run(&redeem(&s, &p, USER_B, Tranche::Junior, 1_000), &[]);
    assert!(dust.raw_result.is_err());
    assert!(has_log(&session, "ZeroAmount"));

    let zero = session.run(&redeem(&s, &p, USER_B, Tranche::Junior, 0), &[]);
    assert!(zero.raw_result.is_err());
    assert!(has_log(&session, "ZeroAmount"));
}

#[test]
fn redeem_with_mismatched_tranche_ata_is_refused() {
    let (mut session, s, p) = funded_pool();
    let mut swapped = redeem(&s, &p, USER_A, Tranche::Senior, 1_000_000);
    let senior_ata = ata(&USER_A, &p.senior_mint);
    let idx = swapped
        .accounts
        .iter()
        .position(|m| m.pubkey == senior_ata)
        .unwrap();
    swapped.accounts[idx].pubkey = ata(&USER_A, &p.junior_mint);
    let result = session.run(&swapped, &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "ParameterOutOfRange"));
}
