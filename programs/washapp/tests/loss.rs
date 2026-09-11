// `record_loss` (T023): обидві гілки waterfall на прикладах брифу M0, ролі,
// межі `loss_bps`, індекси подій, інваріант vault після спалення.
mod common;

use common::{
    assert_pool_invariant, ata, deposit, fund_user, loss_event_state, mint_supply,
    open_tranche_atas, pda, pool_session, pool_state, record_loss, redeem, token_amount,
    ConfigSetup, PoolSetup, Session, GENESIS_TS, OPERATOR, USER_A,
};
use mollusk_svm::result::Check;
use washapp::math::Tranche;

const SENIOR: u64 = 75_000_000_000;
const JUNIOR: u64 = 25_000_000_000;
// Стан брифу M0 після 30 модельних днів — ті самі числа, що в `accrue.rs`/`redeem.rs`.
const SENIOR_AFTER_YIELD: u64 = 75_308_219_178;
const JUNIOR_AFTER_YIELD: u64 = 25_283_561_644;
const ASSETS_AFTER_YIELD: u64 = SENIOR_AFTER_YIELD + JUNIOR_AFTER_YIELD;
const FEE_AFTER_YIELD: u64 = 65_753_424;
const MODEL_TIME_AFTER_YIELD: u64 = 30 * 86_400;

fn has_log(session: &Session, needle: &str) -> bool {
    session.logs().iter().any(|l| l.contains(needle))
}

// Пул брифу M0 через справжні депозити, годинник на +60 с ланцюга; crank не
// викликаний навмисно — `record_loss` має нарахувати дохід сам.
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
    session.harness.warp(2, GENESIS_TS + 60);
    (session, s, p)
}

// SC-003, гілка `L ≤ junior`: збиток 15 % брифу — senior як `u64` той самий,
// junior узяв усе, vault і демо-мінт зменшились рівно на збиток.
#[test]
fn loss_within_junior_leaves_senior_byte_for_byte() {
    let (mut session, s, p) = funded_pool();
    let ix = record_loss(&session, &s, &p, OPERATOR, 1_500);
    session.run(&ix, &[Check::success()]);
    let after = session.snapshot();

    let loss = 15_088_767_123;
    let pool = pool_state(&after, &p.pool);
    assert_eq!(pool.senior_assets, SENIOR_AFTER_YIELD);
    assert_eq!(pool.junior_assets, JUNIOR_AFTER_YIELD - loss);
    assert_eq!(pool.junior_assets, 10_194_794_521);
    assert_eq!(pool.assets, ASSETS_AFTER_YIELD - loss);
    assert_eq!(pool.loss_count, 1);
    assert_eq!(pool.model_time, MODEL_TIME_AFTER_YIELD);
    assert_eq!(token_amount(&after, &p.vault), ASSETS_AFTER_YIELD - loss);
    // Частки не чіпаються — падає лише NAV junior.
    assert_eq!(mint_supply(&after, &p.senior_mint), SENIOR);
    assert_eq!(mint_supply(&after, &p.junior_mint), JUNIOR);
    // Демо-токен: спалене зникло з обігу, комісія в treasury лишилась.
    assert_eq!(
        mint_supply(&after, &s.mint),
        ASSETS_AFTER_YIELD - loss + FEE_AFTER_YIELD
    );
    assert_eq!(token_amount(&after, &s.treasury), FEE_AFTER_YIELD);
    assert_pool_invariant(&after, &p.pool);

    let (key, bump) = pda::loss_event(&p.pool, 0);
    let event = loss_event_state(&after, &key);
    assert_eq!(event.pool, p.pool);
    assert_eq!(event.index, 0);
    assert_eq!(event.ts, GENESIS_TS + 60);
    assert_eq!(event.model_time, MODEL_TIME_AFTER_YIELD);
    assert_eq!(event.loss_bps, 1_500);
    assert_eq!(event.amount, loss);
    assert_eq!(event.junior_loss, loss);
    assert_eq!(event.senior_loss, 0);
    assert_eq!(event.assets_before, ASSETS_AFTER_YIELD);
    assert_eq!(event.bump, bump);
    assert!(session
        .logs()
        .iter()
        .any(|l| l.starts_with("Program data:")));
}

// SC-003, гілка `L > junior`: junior вичерпано до нуля, senior бере рівно різницю.
#[test]
fn loss_beyond_junior_wipes_junior_and_takes_the_rest_from_senior() {
    let (mut session, s, p) = funded_pool();
    let ix = record_loss(&session, &s, &p, OPERATOR, 3_000);
    session.run(&ix, &[Check::success()]);
    let after = session.snapshot();

    let loss = 30_177_534_246;
    let senior_loss = loss - JUNIOR_AFTER_YIELD;
    let pool = pool_state(&after, &p.pool);
    assert_eq!(pool.junior_assets, 0);
    assert_eq!(pool.senior_assets, SENIOR_AFTER_YIELD - senior_loss);
    assert_eq!(pool.senior_assets, 70_414_246_576);
    assert_eq!(pool.assets, ASSETS_AFTER_YIELD - loss);
    assert_eq!(mint_supply(&after, &p.junior_mint), JUNIOR);
    assert_pool_invariant(&after, &p.pool);

    let event = loss_event_state(&after, &pda::loss_event(&p.pool, 0).0);
    assert_eq!(event.amount, loss);
    assert_eq!(event.junior_loss, JUNIOR_AFTER_YIELD);
    assert_eq!(event.senior_loss, senior_loss);
    assert_eq!(event.assets_before, ASSETS_AFTER_YIELD);
}

// 100 %: обидва транші порожні, частки лишились — вичерпаний транш більше не
// обслуговує погашення (`TrancheWipedOut`), пул на цьому закінчується.
#[test]
fn full_loss_empties_the_vault_and_wipes_both_tranches() {
    let (mut session, s, p) = funded_pool();
    let ix = record_loss(&session, &s, &p, OPERATOR, 10_000);
    session.run(&ix, &[Check::success()]);
    let after = session.snapshot();

    let pool = pool_state(&after, &p.pool);
    assert_eq!(
        (pool.assets, pool.senior_assets, pool.junior_assets),
        (0, 0, 0)
    );
    assert_eq!(token_amount(&after, &p.vault), 0);
    assert_eq!(mint_supply(&after, &s.mint), FEE_AFTER_YIELD);
    assert_pool_invariant(&after, &p.pool);

    let event = loss_event_state(&after, &pda::loss_event(&p.pool, 0).0);
    assert_eq!(event.junior_loss, JUNIOR_AFTER_YIELD);
    assert_eq!(event.senior_loss, SENIOR_AFTER_YIELD);

    let result = session.run(&redeem(&s, &p, USER_A, Tranche::Senior, SENIOR), &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "TrancheWipedOut"));
}

#[test]
fn foreign_signer_is_refused_and_leaves_no_event() {
    let (mut session, s, p) = funded_pool();
    let ix = record_loss(&session, &s, &p, USER_A, 1_500);
    let result = session.run(&ix, &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "Unauthorized"));

    let after = session.snapshot();
    assert!(session.get(&pda::loss_event(&p.pool, 0).0).data.is_empty());
    let pool = pool_state(&after, &p.pool);
    assert_eq!(pool.loss_count, 0);
    // Відмова відкотила і нарахування: пул досі на GENESIS_TS.
    assert_eq!(pool.assets, SENIOR + JUNIOR);
    assert_eq!(pool.last_accrued_ts, GENESIS_TS);
    assert_eq!(token_amount(&after, &ata(&USER_A, &s.mint)), 0);
}

#[test]
fn loss_over_one_hundred_percent_is_refused() {
    let (mut session, s, p) = funded_pool();
    let ix = record_loss(&session, &s, &p, OPERATOR, 10_001);
    let result = session.run(&ix, &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "ParameterOutOfRange"));
    assert_eq!(pool_state(&session.snapshot(), &p.pool).loss_count, 0);
}

// Нульовий збиток події не лишає: ні при `bps = 0`, ні на порожньому пулі
// (рішення Павла, T023).
#[test]
fn zero_loss_is_refused() {
    let (mut session, s, p) = funded_pool();
    let ix = record_loss(&session, &s, &p, OPERATOR, 0);
    let result = session.run(&ix, &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "ZeroAmount"));

    let (mut session, s, p) = pool_session();
    session.harness.warp(2, GENESIS_TS + 60);
    let ix = record_loss(&session, &s, &p, OPERATOR, 1_500);
    let result = session.run(&ix, &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "ZeroAmount"));
    assert!(session.get(&pda::loss_event(&p.pool, 0).0).data.is_empty());
}

// Два збитки поспіль: індекси 0 і 1 під різними PDA, другий рахується від
// активів після першого, перший запис після другого не змінився.
#[test]
fn consecutive_losses_get_indices_zero_and_one() {
    let (mut session, s, p) = funded_pool();
    let ix = record_loss(&session, &s, &p, OPERATOR, 1_000);
    session.run(&ix, &[Check::success()]);
    let first_loss = 10_059_178_082;
    let first = loss_event_state(&session.snapshot(), &pda::loss_event(&p.pool, 0).0);
    assert_eq!(first.amount, first_loss);

    let ix = record_loss(&session, &s, &p, OPERATOR, 1_000);
    session.run(&ix, &[Check::success()]);
    let after = session.snapshot();

    let pool = pool_state(&after, &p.pool);
    assert_eq!(pool.loss_count, 2);
    let (key0, _) = pda::loss_event(&p.pool, 0);
    let (key1, _) = pda::loss_event(&p.pool, 1);
    assert_ne!(key0, key1);
    let second = loss_event_state(&after, &key1);
    let second_loss = (ASSETS_AFTER_YIELD - first_loss) / 10;
    assert_eq!(second.index, 1);
    assert_eq!(second.assets_before, ASSETS_AFTER_YIELD - first_loss);
    assert_eq!(second.amount, second_loss);
    assert_eq!(second.junior_loss, second_loss);
    assert_eq!(second.senior_loss, 0);
    let first_again = loss_event_state(&after, &key0);
    assert_eq!(
        (
            first_again.index,
            first_again.amount,
            first_again.assets_before
        ),
        (first.index, first.amount, first.assets_before)
    );

    assert_eq!(pool.senior_assets, SENIOR_AFTER_YIELD);
    assert_eq!(
        pool.junior_assets,
        JUNIOR_AFTER_YIELD - first_loss - second_loss
    );
    assert_eq!(pool.assets, ASSETS_AFTER_YIELD - first_loss - second_loss);
    assert_pool_invariant(&after, &p.pool);
}

// Повтор того самого індексу неможливий: PDA вже існує, `init` відмовляє.
#[test]
fn reusing_an_existing_event_index_is_refused() {
    let (mut session, s, p) = funded_pool();
    let ix = record_loss(&session, &s, &p, OPERATOR, 1_000);
    session.run(&ix, &[Check::success()]);
    let mut stale = record_loss(&session, &s, &p, OPERATOR, 1_000);
    // Підставляємо адресу події 0 замість очікуваної 1.
    stale.accounts[7].pubkey = pda::loss_event(&p.pool, 0).0;
    let result = session.run(&stale, &[]);
    assert!(result.raw_result.is_err());
    assert_eq!(pool_state(&session.snapshot(), &p.pool).loss_count, 1);
}
