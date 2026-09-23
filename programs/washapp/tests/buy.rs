// `buy_protection` (T030): премія за демо-параметрами, резерв номіналу з
// вільного забезпечення, межі строку, знімки порогу й індексу збитку, nonce.
mod common;

use common::{
    assert_pool_invariant, assert_protection_invariant, ata, buy_protection, contract_state,
    deposit, fund_user, open_tranche_atas, pda, pool_session, pool_state, protection_session,
    protection_setup, protection_state, provide_protection, record_loss, seed_protection_rates,
    token_amount, ConfigSetup, PoolSetup, ProtectionSetup, Session, GENESIS_TS, OPERATOR, USER_A,
    USER_B,
};
use mollusk_svm::result::Check;
use solana_pubkey::Pubkey;
use washapp::constants::MAX_TERM_SECONDS;
use washapp::math::Tranche;
use washapp::state::ContractStatus;

const FUNDS: u64 = 10_000_000_000;
const COLLATERAL: u64 = 5_000_000_000;
const NOTIONAL: u64 = 1_000_000_000;
// Строк — модельні секунди: 30 модельних днів, стільки ж, скільки дає 60 с
// ланцюга при `time_scale` демо-пулу.
const TERM: u64 = 30 * 86_400;
const MODEL_TIME_AT_BUY: u64 = 30 * 86_400;
// 1 000 токенів під 2 % річних на 30 модельних днів; комісія — 10 % премії.
const PREMIUM: u64 = 1_643_835;
const FEE: u64 = 164_383;
const NET: u64 = PREMIUM - FEE;

fn has_log(session: &Session, needle: &str) -> bool {
    session.logs().iter().any(|l| l.contains(needle))
}

fn wallet(session: &Session, s: &ConfigSetup, owner: &Pubkey) -> u64 {
    token_amount(&session.snapshot(), &ata(owner, &s.mint))
}

fn contract_at(p: &PoolSetup, buyer: &Pubkey, nonce: u64) -> Pubkey {
    pda::contract(&p.pool, buyer, nonce).0
}

// Ринок захисту: USER_A продав забезпечення, USER_B має чим платити премію,
// годинник — на +60 с ланцюга (30 модельних днів), crank не викликаний:
// `buy_protection` має нарахувати сам.
fn market() -> (Session, ConfigSetup, PoolSetup, ProtectionSetup) {
    let (mut session, s, p, pr) = protection_session();
    fund_user(&mut session, &s, USER_A, FUNDS);
    fund_user(&mut session, &s, USER_B, FUNDS);
    session.run(
        &provide_protection(&s, &p, &pr, USER_A, COLLATERAL),
        &[Check::success()],
    );
    session.harness.warp(2, GENESIS_TS + 60);
    (session, s, p, pr)
}

// Премія — за `fixtures/params.json`: 2 % річних, комісія 10 % у скарбницю,
// решта у pvault; номінал резервується, контракт бере знімки пулу.
#[test]
fn buy_charges_the_demo_premium_and_reserves_the_notional() {
    let (mut session, s, p, pr) = market();
    session.run(
        &buy_protection(&s, &p, &pr, USER_B, NOTIONAL, TERM, 0),
        &[Check::success()],
    );
    let after = session.snapshot();

    assert_eq!(wallet(&session, &s, &USER_B), FUNDS - PREMIUM);
    assert_eq!(token_amount(&after, &s.treasury), FEE);
    assert_eq!(token_amount(&after, &pr.pvault), COLLATERAL + NET);

    let protection = protection_state(&after, &pr.protection);
    assert_eq!(protection.collateral, COLLATERAL + NET);
    assert_eq!(protection.reserved, NOTIONAL);
    assert_eq!(protection.contracts, 1);
    // Продавець дорожчає без нових часток: частки ті самі, забезпечення більше.
    assert_eq!(protection.share_supply, COLLATERAL);

    let key = contract_at(&p, &USER_B, 0);
    let contract = contract_state(&after, &key);
    assert_eq!(contract.pool, p.pool);
    assert_eq!(contract.buyer, USER_B);
    assert_eq!((contract.nonce, contract.notional), (0, NOTIONAL));
    assert_eq!(contract.premium, PREMIUM);
    assert_eq!(contract.start_model_time, MODEL_TIME_AT_BUY);
    assert_eq!(contract.expiry_model_time, MODEL_TIME_AT_BUY + TERM);
    assert_eq!(contract.trigger_bps, pr.trigger_bps);
    assert_eq!(contract.loss_index_from, 0);
    assert_eq!(contract.status, ContractStatus::Active);
    assert_eq!((contract.settled_loss_index, contract.payout), (0, 0));
    assert_eq!(contract.bump, pda::contract(&p.pool, &USER_B, 0).1);

    // Пул нарахував час сам, хоч дохід і нульовий (транші порожні).
    assert_eq!(pool_state(&after, &p.pool).model_time, MODEL_TIME_AT_BUY);
    assert_protection_invariant(&after, &pr.protection);
}

// Номінал міряється вільним забезпеченням до премії: власна премія покриття
// не збільшує.
#[test]
fn notional_beyond_free_collateral_is_refused() {
    let (mut session, s, p, pr) = market();
    let result = session.run(
        &buy_protection(&s, &p, &pr, USER_B, COLLATERAL + 1, TERM, 0),
        &[],
    );
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "InsufficientFreeCollateral"));
    assert_eq!(wallet(&session, &s, &USER_B), FUNDS);

    session.run(
        &buy_protection(&s, &p, &pr, USER_B, COLLATERAL, TERM, 0),
        &[Check::success()],
    );
    let after = session.snapshot();
    let protection = protection_state(&after, &pr.protection);
    // Премія 5 000 токенів на 30 днів: 8 219 178, комісія 821 917.
    let net = 8_219_178 - 821_917;
    assert_eq!(protection.collateral, COLLATERAL + net);
    assert_eq!(protection.reserved, COLLATERAL);

    // Вільним лишилось рівно нетто премії — не номінал наступного контракту.
    let result = session.run(&buy_protection(&s, &p, &pr, USER_B, net + 1, TERM, 1), &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "InsufficientFreeCollateral"));
    assert_protection_invariant(&session.snapshot(), &pr.protection);
}

// Нульовий номінал і строк поза межами — до будь-яких переказів.
#[test]
fn zero_notional_and_term_outside_the_bounds_are_refused() {
    let (mut session, s, p, pr) = market();
    let result = session.run(&buy_protection(&s, &p, &pr, USER_B, 0, TERM, 0), &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "ZeroAmount"));

    let result = session.run(&buy_protection(&s, &p, &pr, USER_B, NOTIONAL, 0, 0), &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "ParameterOutOfRange"));

    let result = session.run(
        &buy_protection(&s, &p, &pr, USER_B, NOTIONAL, MAX_TERM_SECONDS + 1, 0),
        &[],
    );
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "ParameterOutOfRange"));
    assert_eq!(wallet(&session, &s, &USER_B), FUNDS);

    // Стеля включно: 10 років під 2 % — 20 % номіналу премії.
    session.run(
        &buy_protection(&s, &p, &pr, USER_B, NOTIONAL, MAX_TERM_SECONDS, 0),
        &[Check::success()],
    );
    let after = session.snapshot();
    let contract = contract_state(&after, &contract_at(&p, &USER_B, 0));
    assert_eq!(contract.premium, 200_000_000);
    assert_eq!(
        contract.expiry_model_time,
        MODEL_TIME_AT_BUY + MAX_TERM_SECONDS
    );
    assert_eq!(wallet(&session, &s, &USER_B), FUNDS - 200_000_000);
    assert_protection_invariant(&after, &pr.protection);
}

// Премія, що округлилась до нуля при ненульовій ставці, — відмова: інакше
// покупець зарезервував би чуже забезпечення задарма.
#[test]
fn premium_that_rounds_to_zero_is_refused_unless_the_rate_is_zero() {
    let (mut session, s, p, pr) = market();
    // 100 одиниць на 30 днів під 2 % — 0 після ділення вниз.
    let result = session.run(&buy_protection(&s, &p, &pr, USER_B, 100, TERM, 0), &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "ZeroAmount"));
    assert_eq!(wallet(&session, &s, &USER_B), FUNDS);
    assert_eq!(
        protection_state(&session.snapshot(), &pr.protection).reserved,
        0
    );

    // Ставка 0 — свідомий вибір оператора: покриття безкоштовне і законне.
    seed_protection_rates(&mut session, &pr, 0, pr.trigger_bps, pr.premium_fee_bps);
    session.run(
        &buy_protection(&s, &p, &pr, USER_B, NOTIONAL, TERM, 0),
        &[Check::success()],
    );
    let after = session.snapshot();
    let contract = contract_state(&after, &contract_at(&p, &USER_B, 0));
    assert_eq!(contract.premium, 0);
    assert_eq!(contract.notional, NOTIONAL);
    let protection = protection_state(&after, &pr.protection);
    assert_eq!(protection.collateral, COLLATERAL);
    assert_eq!(protection.reserved, NOTIONAL);
    assert_eq!(wallet(&session, &s, &USER_B), FUNDS);
    assert_eq!(token_amount(&after, &s.treasury), 0);
    assert_protection_invariant(&after, &pr.protection);
}

// Два контракти одного покупця живуть під різними nonce; той самий nonce
// удруге не купиться — PDA вже існує.
#[test]
fn two_contracts_of_one_buyer_differ_by_nonce() {
    let (mut session, s, p, pr) = market();
    session.run(
        &buy_protection(&s, &p, &pr, USER_B, NOTIONAL, TERM, 0),
        &[Check::success()],
    );
    session.run(
        &buy_protection(&s, &p, &pr, USER_B, NOTIONAL, TERM, 7),
        &[Check::success()],
    );
    let after = session.snapshot();

    let (first, second) = (contract_at(&p, &USER_B, 0), contract_at(&p, &USER_B, 7));
    assert_ne!(first, second);
    assert_eq!(contract_state(&after, &first).nonce, 0);
    assert_eq!(contract_state(&after, &second).nonce, 7);
    let protection = protection_state(&after, &pr.protection);
    assert_eq!(protection.reserved, 2 * NOTIONAL);
    assert_eq!(protection.contracts, 2);
    assert_eq!(protection.collateral, COLLATERAL + 2 * NET);
    assert_eq!(wallet(&session, &s, &USER_B), FUNDS - 2 * PREMIUM);

    let result = session.run(&buy_protection(&s, &p, &pr, USER_B, NOTIONAL, TERM, 0), &[]);
    assert!(result.raw_result.is_err());
    assert_eq!(
        protection_state(&session.snapshot(), &pr.protection).contracts,
        2
    );
    assert_protection_invariant(&session.snapshot(), &pr.protection);
}

// Купівля нараховує дохід пулу сама і бере індекс збитку знімком: подія, що
// вже сталася, новим контрактом не покривається.
#[test]
fn buy_accrues_the_pool_and_snapshots_the_loss_index() {
    let (mut session, s, p, pr) = market();
    open_tranche_atas(&mut session, &p, USER_A);
    session.run(
        &deposit(&s, &p, USER_A, Tranche::Junior, 1_000_000_000),
        &[Check::success()],
    );
    session.run(
        &deposit(&s, &p, USER_A, Tranche::Senior, 3_000_000_000),
        &[Check::success()],
    );
    // Годинник іде далі: дохід уже ненульовий, бо транші не порожні.
    session.harness.warp(3, GENESIS_TS + 120);
    let ix = record_loss(&session, &s, &p, OPERATOR, 1_000);
    session.run(&ix, &[Check::success()]);
    let pool_after_loss = pool_state(&session.snapshot(), &p.pool);
    assert_eq!(pool_after_loss.loss_count, 1);

    session.run(
        &buy_protection(&s, &p, &pr, USER_B, NOTIONAL, TERM, 0),
        &[Check::success()],
    );
    let after = session.snapshot();
    let contract = contract_state(&after, &contract_at(&p, &USER_B, 0));
    assert_eq!(contract.loss_index_from, 1);
    // Той самий слот, що й `record_loss`: модельний час зсунувся до купівлі, не в ній.
    assert_eq!(contract.start_model_time, pool_after_loss.model_time);
    assert_eq!(
        contract.expiry_model_time,
        pool_after_loss.model_time + TERM
    );
    assert_eq!(
        pool_state(&after, &p.pool).model_time,
        contract.start_model_time
    );
    assert_pool_invariant(&after, &p.pool);
    assert_protection_invariant(&after, &pr.protection);
}

// Чужий pvault, чужа адреса контракту і купівля до `init_protection` —
// відмова на розкладці акаунтів, до математики.
#[test]
fn foreign_accounts_and_buying_before_init_protection_are_refused() {
    let (mut session, s, p, pr) = market();

    let mut forged = buy_protection(&s, &p, &pr, USER_B, NOTIONAL, TERM, 0);
    forged.accounts[8].pubkey = ata(&USER_A, &s.mint);
    let result = session.run(&forged, &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "ConstraintAddress"));

    // Адреса контракту іншого покупця під тим самим nonce.
    let mut forged = buy_protection(&s, &p, &pr, USER_B, NOTIONAL, TERM, 0);
    forged.accounts[10].pubkey = contract_at(&p, &USER_A, 0);
    let result = session.run(&forged, &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "ConstraintSeeds"));

    assert_eq!(wallet(&session, &s, &USER_B), FUNDS);
    assert_eq!(
        protection_state(&session.snapshot(), &pr.protection).reserved,
        0
    );

    let (mut session, s, p) = pool_session();
    let pr = protection_setup(&p);
    fund_user(&mut session, &s, USER_B, FUNDS);
    let result = session.run(&buy_protection(&s, &p, &pr, USER_B, NOTIONAL, TERM, 0), &[]);
    assert!(result.raw_result.is_err());
    assert!(has_log(&session, "AccountNotInitialized"));
    assert_eq!(wallet(&session, &s, &USER_B), FUNDS);
}
