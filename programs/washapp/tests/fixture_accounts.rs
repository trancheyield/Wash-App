// Байти акаунтів із SVM для TS-боку: `fixtures/accounts/m0.json` — стан пулу
// брифу M0 після 30 модельних днів і, окремим розділом, той самий пул після
// збитку 15 % (аркуш 3 брифу, T025). `read.ts`/`view.ts` (T017) і білдери (T018)
// перевіряються на справжніх байтах, а не на тому, що кодек Codama погодився
// зі своїм же декодером.
mod common;

use std::path::PathBuf;

use common::{
    accrue, ata, buy_protection, deposit, fund_user, init_protection, open_tranche_atas, pda,
    pool_session, protection_setup, provide_protection, record_loss, settle_protection,
    ConfigSetup, PoolSetup, Session, GENESIS_TS, OPERATOR, USER_A, USER_B,
};
use mollusk_svm::result::Check;
use serde_json::{json, Value};
use solana_pubkey::Pubkey;
use washapp::math::Tranche;

const SENIOR: u64 = 75_000_000_000;
const JUNIOR: u64 = 25_000_000_000;

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/accounts/m0.json")
}

fn protection_fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/accounts/protection.json")
}

// Сценарій брифу: USER_A кладе 25 000 у junior і 75 000 у senior у GENESIS_TS,
// через 60 с ланцюга (30 модельних днів) — crank.
pub fn m0_state() -> (Session, ConfigSetup, PoolSetup) {
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
    session.run(&accrue(&s, &p), &[Check::success()]);
    (session, s, p)
}

fn entry(session: &Session, key: Pubkey) -> Value {
    let account = session.get(&key);
    let hex: String = account.data.iter().map(|b| format!("{b:02x}")).collect();
    json!({
        "address": key.to_string(),
        "owner": account.owner.to_string(),
        "lamports": account.lamports,
        "data": hex,
    })
}

const LOSS_BPS: u16 = 1_500;

fn fixture() -> Value {
    let (mut session, s, p) = m0_state();
    let before = json!({
        "comment": "Згенеровано `cargo test --workspace -- --ignored gen_account_fixtures` (wsl-build.sh fixtures). Не правити руками: read.test.ts декодує ці байти.",
        "scenario": "USER_A: 25 000 junior + 75 000 senior у GENESIS_TS, accrue через 60 с (30 модельних днів при 8 %/5 %/10 % комісії, time_scale 43 200)",
        "genesisTs": GENESIS_TS,
        "poolId": p.id,
        "operator": s.authority.to_string(),
        "owner": USER_A.to_string(),
        "accounts": {
            "config": entry(&session, s.config),
            "mint": entry(&session, s.mint),
            "treasury": entry(&session, s.treasury),
            "pool": entry(&session, p.pool),
            "vault": entry(&session, p.vault),
            "seniorMint": entry(&session, p.senior_mint),
            "juniorMint": entry(&session, p.junior_mint),
            "ownerBase": entry(&session, ata(&USER_A, &s.mint)),
            "ownerSenior": entry(&session, ata(&USER_A, &p.senior_mint)),
            "ownerJunior": entry(&session, ata(&USER_A, &p.junior_mint)),
        },
    });
    // Той самий слот: збиток лягає на стан вище без додаткового доходу, тож
    // «до» в події дорівнює `assets` розділу вище.
    let ix = record_loss(&session, &s, &p, OPERATOR, LOSS_BPS);
    session.run(&ix, &[Check::success()]);
    let mut fixture = before;
    fixture["afterLoss"] = json!({
        "scenario": "record_loss 15 % оператором у тому самому слоті, що й accrue: junior бере все, senior без змін",
        "lossBps": LOSS_BPS,
        "accounts": {
            "pool": entry(&session, p.pool),
            "vault": entry(&session, p.vault),
            "mint": entry(&session, s.mint),
            "lossEvent0": entry(&session, pda::loss_event(&p.pool, 0).0),
        },
    });
    fixture
}

const COLLATERAL: u64 = 5_000_000_000;
const TERM: u64 = 30 * 86_400;
// Two contracts of the buyer and one of the seller: the wallet reader filters a
// buyer's contracts out of the whole program, so a foreign one has to be there.
const CONTRACTS: [(Pubkey, u64, u64); 3] = [
    (USER_B, 0, 1_000_000_000),
    (USER_B, 1, 500_000_000),
    (USER_A, 2, 100_000_000),
];

// The protection market on the M0 pool (T032): USER_A sells collateral, USER_B
// buys two contracts and USER_A one, a 15 % loss is recorded and USER_B's first
// contract is settled. Everything runs in the slot of the M0 crank, so the
// contracts start at model day 30.
fn protection_fixture() -> Value {
    let (mut session, s, p) = m0_state();
    let pr = protection_setup(&p);
    session.run(
        &init_protection(&s, &p, &pr, s.authority),
        &[Check::success()],
    );
    fund_user(&mut session, &s, USER_A, COLLATERAL + 1_000_000_000);
    fund_user(&mut session, &s, USER_B, 1_000_000_000);
    session.run(
        &provide_protection(&s, &p, &pr, USER_A, COLLATERAL),
        &[Check::success()],
    );
    for (buyer, nonce, notional) in CONTRACTS {
        session.run(
            &buy_protection(&s, &p, &pr, buyer, notional, TERM, nonce),
            &[Check::success()],
        );
    }
    let ix = record_loss(&session, &s, &p, OPERATOR, LOSS_BPS);
    session.run(&ix, &[Check::success()]);
    session.run(
        &settle_protection(&s, &p, &pr, USER_B, 0, 0),
        &[Check::success()],
    );

    let contract = |buyer: &Pubkey, nonce: u64| pda::contract(&p.pool, buyer, nonce).0;
    json!({
        "comment": "Generated by `cargo test --workspace -- --ignored gen_account_fixtures` (wsl-build.sh fixtures). Do not edit: the protection builders and readers decode these bytes.",
        "scenario": "M0 pool after 30 model days; USER_A provides 5,000 collateral, USER_B buys 1,000 (nonce 0) and 500 (nonce 1), USER_A buys 100 (nonce 2), all for 30 model days; record_loss 15 %, settle of nonce 0 on event 0",
        "poolId": p.id,
        "operator": s.authority.to_string(),
        "seller": USER_A.to_string(),
        "buyer": USER_B.to_string(),
        "term": TERM,
        "lossBps": LOSS_BPS,
        "accounts": {
            "protection": entry(&session, pr.protection),
            "pvault": entry(&session, pr.pvault),
            "sellerPosition": entry(&session, pda::seller(&p.pool, &USER_A).0),
            "sellerBase": entry(&session, ata(&USER_A, &s.mint)),
            "buyerBase": entry(&session, ata(&USER_B, &s.mint)),
            "contract0": entry(&session, contract(&USER_B, 0)),
            "contract1": entry(&session, contract(&USER_B, 1)),
            "contract2": entry(&session, contract(&USER_A, 2)),
            "lossEvent0": entry(&session, pda::loss_event(&p.pool, 0).0),
        },
    })
}

fn write_fixture(path: PathBuf, value: &Value) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let text = serde_json::to_string_pretty(value).unwrap() + "\n";
    std::fs::write(path, text).unwrap();
}

#[test]
#[ignore = "генератор фікстури: wsl-build.sh fixtures"]
fn gen_account_fixtures() {
    write_fixture(fixture_path(), &fixture());
    write_fixture(protection_fixture_path(), &protection_fixture());
}

// Розкладка акаунта змінилась — фікстура застаріла, а TS-тести далі зеленіють
// проти старих байтів. Цей тест тримає її прив'язаною до програми.
#[test]
fn account_fixture_matches_program() {
    let path = fixture_path();
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("{}: {e} — wsl-build.sh fixtures", path.display()));
    let stored: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(
        stored,
        fixture(),
        "fixtures/accounts/m0.json застаріла — wsl-build.sh fixtures"
    );
}

#[test]
fn protection_fixture_matches_program() {
    let path = protection_fixture_path();
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("{}: {e} — wsl-build.sh fixtures", path.display()));
    let stored: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(
        stored,
        protection_fixture(),
        "fixtures/accounts/protection.json is stale — wsl-build.sh fixtures"
    );
}
