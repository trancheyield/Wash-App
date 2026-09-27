// CU-гейт (SC-005): кожна інструкція M1 на демо-сценарії брифу M0 — під стелею
// 200 000. Ключі фіксовані (`common`), інакше bump-пошук PDA гуляє на ~1 500 CU
// за спробу і гейт то проходить, то ні. Фактичні числа — в SCRATCHPAD; щоб
// побачити їх, `cargo test --test cu -- --nocapture`.
mod common;

use common::{
    ata, buy_protection, config_setup, configured_session, create_pool, demo_params, deposit,
    expire_protection, faucet, fund_user, init_config, init_config_accounts, init_protection,
    open_tranche_atas, pool_session, pool_setup, protection_setup, provide_protection, record_loss,
    redeem, settle_protection, signer_account, withdraw_protection, Harness, Session, GENESIS_TS,
    OPERATOR, USER_A, USER_B,
};
use mollusk_svm::result::{Check, InstructionResult};
use washapp::math::Tranche;

const CEILING: u64 = 200_000;
const SENIOR: u64 = 75_000_000_000;
const JUNIOR: u64 = 25_000_000_000;

fn gate(name: &str, result: &InstructionResult) -> u64 {
    assert!(result.raw_result.is_ok(), "{name}: інструкція відмовила");
    let cu = result.compute_units_consumed;
    println!("CU {name:<28} {cu:>7}");
    assert!(cu < CEILING, "{name}: {cu} CU ≥ стелі {CEILING}");
    cu
}

fn run(session: &mut Session, name: &str, ix: &solana_instruction::Instruction) -> u64 {
    let result = session.run(ix, &[Check::success()]);
    gate(name, &result)
}

#[test]
fn init_config_and_create_pool_fit_the_ceiling() {
    let s = config_setup();
    let mut h = Harness::new();
    let result = h.process(
        &init_config(&s),
        &init_config_accounts(&s),
        &[Check::success()],
    );
    gate("init_config", &result);

    let (mut session, s) = configured_session();
    let (id, params) = demo_params();
    let p = pool_setup(id, params);
    session.harness.warp(1, GENESIS_TS);
    run(
        &mut session,
        "create_pool",
        &create_pool(&s, &p, s.authority),
    );
}

#[test]
fn faucet_fits_the_ceiling_with_and_without_ata() {
    let (mut session, s) = configured_session();
    session.set(USER_A, signer_account());
    run(
        &mut session,
        "faucet (створює ATA)",
        &faucet(&s, USER_A, 1_000),
    );
    run(&mut session, "faucet (ATA є)", &faucet(&s, USER_A, 1_000));
}

// Найдорожчі шляхи: accrue з обома CPI, депозит за NAV із subordination,
// погашення junior зі subordination, збиток з accrue + burn + init події —
// усі після 30 модельних днів.
#[test]
fn user_instructions_fit_the_ceiling_on_the_m0_scenario() {
    let (mut session, s, p) = pool_session();
    for user in [USER_A, USER_B] {
        session.set(user, signer_account());
        session.run(&faucet(&s, user, SENIOR + JUNIOR), &[Check::success()]);
        open_tranche_atas(&mut session, &p, user);
    }

    run(
        &mut session,
        "deposit junior (перший, 1:1)",
        &deposit(&s, &p, USER_A, Tranche::Junior, JUNIOR),
    );
    run(
        &mut session,
        "deposit senior (1:1 + floor)",
        &deposit(&s, &p, USER_A, Tranche::Senior, SENIOR),
    );

    session.harness.warp(2, GENESIS_TS + 60);
    run(
        &mut session,
        "accrue (30 днів, 2 CPI)",
        &common::accrue(&s, &p),
    );

    session.harness.warp(3, GENESIS_TS + 120);
    run(
        &mut session,
        "deposit senior (NAV + accrue)",
        &deposit(&s, &p, USER_B, Tranche::Senior, 20_000_000_000),
    );
    run(
        &mut session,
        "deposit junior (NAV + accrue)",
        &deposit(&s, &p, USER_B, Tranche::Junior, 10_000_000_000),
    );

    session.harness.warp(4, GENESIS_TS + 180);
    run(
        &mut session,
        "redeem junior (NAV + floor)",
        &redeem(&s, &p, USER_A, Tranche::Junior, 1_000_000_000),
    );
    run(
        &mut session,
        "redeem senior (NAV + accrue)",
        &redeem(&s, &p, USER_A, Tranche::Senior, SENIOR),
    );
    assert!(common::token_amount(&session.snapshot(), &ata(&USER_A, &s.mint)) > SENIOR);

    // Обидві гілки waterfall: 15 % лягає на junior, 80 % вичерпує його і доходить до senior.
    session.harness.warp(5, GENESIS_TS + 240);
    let ix = record_loss(&session, &s, &p, OPERATOR, 1_500);
    run(&mut session, "record_loss (junior, accrue)", &ix);
    session.harness.warp(6, GENESIS_TS + 300);
    let ix = record_loss(&session, &s, &p, OPERATOR, 8_000);
    run(&mut session, "record_loss (into senior)", &ix);
    let pool = common::pool_state(&session.snapshot(), &p.pool);
    assert_eq!(pool.loss_count, 2);
    assert_eq!(pool.junior_assets, 0);
    assert!(pool.senior_assets > 0);
}

// The protection market on the same demo pool. The expensive paths: the first
// `provide` creates the seller position, `buy` and `expire` run accrue with both
// CPIs after 30 model days, `settle` signs the payout for the protection pool.
#[test]
fn protection_instructions_fit_the_ceiling() {
    const TERM: u64 = 30 * 86_400;
    const NOTIONAL: u64 = 1_000_000_000;
    let (mut session, s, p) = pool_session();
    let pr = protection_setup(&p);
    run(
        &mut session,
        "init_protection",
        &init_protection(&s, &p, &pr, s.authority),
    );

    fund_user(&mut session, &s, USER_A, SENIOR + JUNIOR + 10_000_000_000);
    fund_user(&mut session, &s, USER_B, SENIOR + JUNIOR);
    open_tranche_atas(&mut session, &p, USER_A);
    session.run(
        &deposit(&s, &p, USER_A, Tranche::Junior, JUNIOR),
        &[Check::success()],
    );
    session.run(
        &deposit(&s, &p, USER_A, Tranche::Senior, SENIOR),
        &[Check::success()],
    );

    run(
        &mut session,
        "provide (creates position)",
        &provide_protection(&s, &p, &pr, USER_A, 5_000_000_000),
    );
    run(
        &mut session,
        "provide (position exists)",
        &provide_protection(&s, &p, &pr, USER_A, 1_000_000_000),
    );
    run(
        &mut session,
        "withdraw_protection",
        &withdraw_protection(&s, &p, &pr, USER_A, 500_000_000),
    );

    session.harness.warp(2, GENESIS_TS + 60);
    run(
        &mut session,
        "buy (accrue, premium, init)",
        &buy_protection(&s, &p, &pr, USER_B, NOTIONAL, TERM, 0),
    );
    run(
        &mut session,
        "buy (second nonce)",
        &buy_protection(&s, &p, &pr, USER_B, NOTIONAL, TERM, 1),
    );

    session.harness.warp(3, GENESIS_TS + 90);
    let ix = record_loss(&session, &s, &p, OPERATOR, 1_500);
    session.run(&ix, &[Check::success()]);
    run(
        &mut session,
        "settle_protection",
        &settle_protection(&s, &p, &pr, USER_B, 0, 0),
    );

    // The term is 60 chain seconds from the purchase at +60.
    session.harness.warp(4, GENESIS_TS + 180);
    run(
        &mut session,
        "expire (accrue, buyer)",
        &expire_protection(&s, &p, &pr, USER_B, 1, USER_B),
    );
}
