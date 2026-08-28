mod common;

use common::{
    accrue, assert_pool_invariant, mint_supply, pool_session, pool_state, seed_pool_balances,
    token_amount, GENESIS_TS,
};
use mollusk_svm::result::Check;
use solana_pubkey::Pubkey;

const DAY: u64 = 86_400;
const SENIOR: u64 = 75_000_000_000;
const JUNIOR: u64 = 25_000_000_000;

// Демо-масштаб 43 200: одна хвилина ланцюга — 30 модельних днів.
fn wall_seconds_for_model_days(time_scale: u32, days: u64) -> i64 {
    (days * DAY / time_scale as u64) as i64
}

#[test]
fn accrue_after_30_model_days_matches_the_m0_brief() {
    let (mut session, s, p) = pool_session();
    seed_pool_balances(&mut session, &p, SENIOR, JUNIOR);
    let demo_supply_before = mint_supply(&session.snapshot(), &s.mint);
    let minute = wall_seconds_for_model_days(p.params.time_scale, 30);
    assert_eq!(minute, 60);

    session.harness.warp(2, GENESIS_TS + minute);
    session.run(&accrue(&s, &p), &[Check::success()]);
    let after = session.snapshot();

    let pool = pool_state(&after, &p.pool);
    assert_eq!(pool.senior_assets, 75_308_219_178);
    assert_eq!(pool.junior_assets, 25_283_561_644);
    assert_eq!(pool.assets, 100_591_780_822);
    assert_eq!(pool.model_time, 30 * DAY);
    assert_eq!(pool.last_accrued_ts, GENESIS_TS + minute);
    // Дохід карбується у vault, комісія — у treasury, усе — з демо-мінта.
    assert_eq!(token_amount(&after, &s.treasury), 65_753_424);
    assert_eq!(
        mint_supply(&after, &s.mint),
        demo_supply_before + 657_534_246
    );
    // Supply траншів не змінюється — росте NAV, не кількість часток.
    assert_eq!(mint_supply(&after, &p.senior_mint), SENIOR);
    assert_eq!(mint_supply(&after, &p.junior_mint), JUNIOR);
    assert_pool_invariant(&after, &p.pool);
    assert!(session
        .logs()
        .iter()
        .any(|l| l.starts_with("Program data:")));
}

#[test]
fn accrue_twice_in_the_same_second_changes_nothing() {
    let (mut session, s, p) = pool_session();
    seed_pool_balances(&mut session, &p, SENIOR, JUNIOR);
    session.harness.warp(2, GENESIS_TS + 60);
    session.run(&accrue(&s, &p), &[Check::success()]);
    let first = session.snapshot();

    session.run(&accrue(&s, &p), &[Check::success()]);
    let second = session.snapshot();
    for key in [p.pool, p.vault, s.treasury, s.mint] {
        assert_eq!(
            common::account_of(&first, &key).data,
            common::account_of(&second, &key).data,
            "{key} змінився при повторному accrue"
        );
    }
}

// Чотири crank-и по 7,5 модельних днів дають не менше, ніж один на 30: дохід
// попереднього кроку вже в активах (простий відсоток за інтервал, складний —
// між crank-ами). Тест фіксує інваріант на кожному кроці, не точну суму.
#[test]
fn accrue_in_steps_keeps_the_invariant_on_every_step() {
    let (mut session, s, p) = pool_session();
    seed_pool_balances(&mut session, &p, SENIOR, JUNIOR);
    for step in 1..=4 {
        session
            .harness
            .warp(1 + step, GENESIS_TS + 15 * step as i64);
        session.run(&accrue(&s, &p), &[Check::success()]);
        let after = session.snapshot();
        assert_pool_invariant(&after, &p.pool);
        assert_eq!(
            pool_state(&after, &p.pool).model_time,
            15 * step * p.params.time_scale as u64
        );
    }
    let pool = pool_state(&session.snapshot(), &p.pool);
    assert!(pool.assets >= 100_591_780_822);
}

#[test]
fn accrue_with_empty_junior_gives_everything_to_senior() {
    let (mut session, s, p) = pool_session();
    seed_pool_balances(&mut session, &p, SENIOR, 0);
    session.harness.warp(2, GENESIS_TS + 60);
    session.run(&accrue(&s, &p), &[Check::success()]);
    let after = session.snapshot();

    let pool = pool_state(&after, &p.pool);
    assert_eq!(pool.senior_assets, SENIOR + 443_835_616);
    assert_eq!(pool.junior_assets, 0);
    assert_eq!(token_amount(&after, &s.treasury), 49_315_068);
    assert_pool_invariant(&after, &p.pool);
}

#[test]
fn accrue_with_empty_senior_gives_everything_to_junior() {
    let (mut session, s, p) = pool_session();
    seed_pool_balances(&mut session, &p, 0, JUNIOR);
    session.harness.warp(2, GENESIS_TS + 60);
    session.run(&accrue(&s, &p), &[Check::success()]);
    let after = session.snapshot();

    let pool = pool_state(&after, &p.pool);
    assert_eq!(pool.senior_assets, 0);
    assert_eq!(pool.junior_assets, JUNIOR + 147_945_205);
    assert_eq!(token_amount(&after, &s.treasury), 16_438_356);
    assert_pool_invariant(&after, &p.pool);
}

// Порожній пул: годинник іде, доходу немає, демо-мінт не росте.
#[test]
fn accrue_on_empty_pool_only_moves_the_model_clock() {
    let (mut session, s, p) = pool_session();
    let demo_supply_before = mint_supply(&session.snapshot(), &s.mint);
    session.harness.warp(2, GENESIS_TS + 60);
    session.run(&accrue(&s, &p), &[Check::success()]);
    let after = session.snapshot();

    let pool = pool_state(&after, &p.pool);
    assert_eq!(pool.model_time, 30 * DAY);
    assert_eq!(pool.assets, 0);
    assert_eq!(token_amount(&after, &p.vault), 0);
    assert_eq!(mint_supply(&after, &s.mint), demo_supply_before);
    assert_pool_invariant(&after, &p.pool);
}

// Годинник назад (warp у тесті чи збій валідатора): нуль доходу, позначка
// часу не зсувається назад — інакше наступний crank нарахував би двічі.
#[test]
fn accrue_with_clock_behind_last_accrual_is_a_no_op() {
    let (mut session, s, p) = pool_session();
    seed_pool_balances(&mut session, &p, SENIOR, JUNIOR);
    session.harness.warp(2, GENESIS_TS - 60);
    session.run(&accrue(&s, &p), &[Check::success()]);
    let pool = pool_state(&session.snapshot(), &p.pool);
    assert_eq!(pool.assets, SENIOR + JUNIOR);
    assert_eq!(pool.model_time, 0);
    assert_eq!(pool.last_accrued_ts, GENESIS_TS);
}

#[test]
fn accrue_with_foreign_treasury_or_vault_is_refused() {
    let (mut session, s, p) = pool_session();
    seed_pool_balances(&mut session, &p, SENIOR, JUNIOR);
    session.harness.warp(2, GENESIS_TS + 60);

    let mut s2 = common::config_setup();
    s2.treasury = Pubkey::new_from_array([97; 32]);
    assert!(session.run(&accrue(&s2, &p), &[]).raw_result.is_err());

    let mut p2 = common::pool_setup(p.id, p.params);
    p2.vault = Pubkey::new_from_array([98; 32]);
    assert!(session.run(&accrue(&s, &p2), &[]).raw_result.is_err());

    // Відмови не зсунули стан: справжній crank нараховує з нуля.
    session.run(&accrue(&s, &p), &[Check::success()]);
    assert_eq!(
        pool_state(&session.snapshot(), &p.pool).assets,
        100_591_780_822
    );
}
