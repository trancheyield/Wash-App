// CU-гейт (SC-005): кожна інструкція US1 на демо-сценарії брифу M0 — під стелею
// 200 000. Ключі фіксовані (`common`), інакше bump-пошук PDA гуляє на ~1 500 CU
// за спробу і гейт то проходить, то ні. Фактичні числа — в SCRATCHPAD; щоб
// побачити їх, `cargo test --test cu -- --nocapture`.
mod common;

use common::{
    ata, config_setup, configured_session, create_pool, demo_params, deposit, faucet, init_config,
    init_config_accounts, open_tranche_atas, pool_session, pool_setup, redeem, signer_account,
    Harness, Session, GENESIS_TS, USER_A, USER_B,
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
// погашення junior зі subordination — усі після 30 модельних днів.
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
}
