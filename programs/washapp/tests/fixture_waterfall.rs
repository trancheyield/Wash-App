// Фікстура для TS-дзеркала `math.rs` (`packages/shared/src/waterfall.ts`):
// нарахування, частки при депозиті, сума при погашенні, субординація, waterfall
// збитку. Генерується з Rust і комітиться; `waterfall.test.ts` проганяє ті самі
// входи через TS і звіряє кожне число байт у байт (PLAN, ризик #9). Сторож
// нижче валить `cargo test`, коли формула змінилась, а фікстура — ні.
//
// The `scenarios` section is differential (SC-006): random pool states and
// contracts run through the real `record_loss` and `settle_protection` on the
// same `.so` that is deployed, so the handler's checks are covered too, not only
// the formulas of `math.rs`.
mod common;

use std::path::PathBuf;
use std::sync::OnceLock;

use anchor_lang::error::Error;
use anchor_lang::AccountSerialize;
use common::{
    assert_pool_invariant, assert_protection_invariant, ata, buy_protection, contract_state,
    fund_user, loss_event_state, mint_supply, pda, pool_state, protection_session,
    protection_state, provide_protection, record_loss, seed_pool_state, seed_protection_rates,
    seed_protection_state, settle_protection, token_amount, ConfigSetup, PoolSetup,
    ProtectionSetup, Session, GENESIS_TS, OPERATOR, USER_A, USER_B,
};
use mollusk_svm::result::Check;
use serde_json::{json, Value};
use washapp::errors::WashError;
use washapp::math::{
    accrue, amount_for_redeem, apply_loss, loss_amount, shares_for_deposit, subordination_ok,
    PoolBalances, Rates,
};

const DAY: u64 = 86_400;
const DEMO_SCALE: u64 = 43_200;
const SCENARIOS: u64 = 60;
const BUYER_FUNDS: u64 = 1_000_000_000_000;

// Фікстура живе в корені репо: `cargo test` запускається з теки пакета.
fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/waterfall.json")
}

// xorshift64*: детермінований генератор без залежностей — той самий, що в
// `sequence.rs`; фікстура від прогону до прогону однакова, інакше сторож не
// мав би з чим порівнювати.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    fn below(&mut self, n: u64) -> u64 {
        if n == 0 {
            0
        } else {
            self.next() % n
        }
    }
}

fn demo_rates() -> Rates {
    let params: Value =
        serde_json::from_str(include_str!("../../../fixtures/params.json")).unwrap();
    let bps = |k: &str| u16::try_from(params[k].as_u64().unwrap()).unwrap();
    Rates {
        yield_bps: bps("yield_rate_bps"),
        senior_bps: bps("senior_rate_bps"),
        fee_bps: bps("perf_fee_bps"),
    }
}

fn demo_pool() -> PoolBalances {
    PoolBalances {
        assets: 100_000_000_000,
        senior_assets: 75_000_000_000,
        junior_assets: 25_000_000_000,
        senior_supply: 75_000_000_000,
        junior_supply: 25_000_000_000,
    }
}

// Усі `u64` — рядками: `u64::MAX` не вміщається у JSON-число без втрати, а TS
// читає їх у `bigint`. Ставки (`u16`) — числами.
fn s(v: u64) -> Value {
    Value::String(v.to_string())
}

fn pool_json(p: &PoolBalances) -> Value {
    json!({
        "assets": s(p.assets),
        "seniorAssets": s(p.senior_assets),
        "juniorAssets": s(p.junior_assets),
        "seniorSupply": s(p.senior_supply),
        "juniorSupply": s(p.junior_supply),
    })
}

fn rates_json(r: &Rates) -> Value {
    json!({ "yieldBps": r.yield_bps, "seniorBps": r.senior_bps, "feeBps": r.fee_bps })
}

// Назва помилки — та, що TS-дзеркало кидає своїм `WaterfallError`.
fn error_name(err: &Error) -> &'static str {
    for (code, name) in [
        (WashError::TrancheWipedOut, "TrancheWipedOut"),
        (WashError::ParameterOutOfRange, "ParameterOutOfRange"),
        (WashError::Overflow, "Overflow"),
    ] {
        if *err == Error::from(code) {
            return name;
        }
    }
    panic!("несподівана помилка у фікстурі: {err:?}")
}

fn random_pool(rng: &mut Rng) -> PoolBalances {
    // Активи й supply розходяться (NAV ≠ 1), щоб ділення мало залишок.
    let senior_supply = rng.below(200_000_000_000);
    let junior_supply = rng.below(80_000_000_000);
    let senior_assets = if senior_supply == 0 {
        0
    } else {
        senior_supply + rng.below(senior_supply / 4 + 1)
    };
    let junior_assets = if junior_supply == 0 {
        0
    } else {
        rng.below(junior_supply + junior_supply / 2 + 1)
    };
    PoolBalances {
        assets: senior_assets + junior_assets,
        senior_assets,
        junior_assets,
        senior_supply,
        junior_supply,
    }
}

fn random_rates(rng: &mut Rng) -> Rates {
    Rates {
        yield_bps: rng.below(2_001) as u16,
        senior_bps: rng.below(1_501) as u16,
        fee_bps: rng.below(3_001) as u16,
    }
}

fn accrue_case(pool: PoolBalances, rates: Rates, dt_model: u64) -> Value {
    assert_eq!(pool.assets, pool.senior_assets + pool.junior_assets);
    let accrual = accrue(&pool, &rates, dt_model).unwrap();
    let after = pool.after_accrual(&accrual).unwrap();
    json!({
        "pool": pool_json(&pool),
        "rates": rates_json(&rates),
        "dtModel": s(dt_model),
        "accrual": {
            "yieldAmount": s(accrual.yield_amount),
            "fee": s(accrual.fee),
            "seniorGain": s(accrual.senior_gain),
            "juniorGain": s(accrual.junior_gain),
        },
        "after": pool_json(&after),
    })
}

fn accrue_cases() -> Vec<Value> {
    let demo = demo_rates();
    let thin = Rates {
        yield_bps: 100,
        senior_bps: 500,
        fee_bps: 1_000,
    };
    let only_senior = PoolBalances {
        assets: 75_000_000_000,
        junior_assets: 0,
        junior_supply: 0,
        ..demo_pool()
    };
    let only_junior = PoolBalances {
        assets: 25_000_000_000,
        senior_assets: 0,
        senior_supply: 0,
        ..demo_pool()
    };
    let mut cases = vec![
        // Золоті числа брифу M0 — 30 модельних днів.
        accrue_case(demo_pool(), demo, 30 * DAY),
        // Пул простояв 24 хв реального часу на демо-масштабі — 2 модельні роки;
        // це той випадок, заради якого прев'ю рахує нарахування.
        accrue_case(demo_pool(), demo, 24 * 60 * DEMO_SCALE),
        accrue_case(demo_pool(), demo, 0),
        accrue_case(demo_pool(), demo, 1),
        accrue_case(demo_pool(), thin, 30 * DAY),
        accrue_case(only_senior, demo, 30 * DAY),
        accrue_case(only_junior, demo, 30 * DAY),
        accrue_case(PoolBalances::default(), demo, 30 * DAY),
        // Supply без активів (транш вичерпаний збитком): дохід іде іншому траншу.
        accrue_case(
            PoolBalances {
                assets: 75_000_000_000,
                junior_assets: 0,
                ..demo_pool()
            },
            demo,
            30 * DAY,
        ),
        // Великі числа: 10¹⁵ мікро-одиниць на 10 модельних років без переповнення.
        accrue_case(
            PoolBalances {
                assets: 1_000_000_000_000_000,
                senior_assets: 700_000_000_000_000,
                junior_assets: 300_000_000_000_000,
                senior_supply: 650_000_000_000_000,
                junior_supply: 310_000_000_000_000,
            },
            Rates {
                yield_bps: 10_000,
                senior_bps: 10_000,
                fee_bps: 2_000,
            },
            10 * 365 * DAY,
        ),
    ];
    let mut rng = Rng(0x5747_4552_4641_4c4c);
    for _ in 0..30 {
        let pool = random_pool(&mut rng);
        let rates = random_rates(&mut rng);
        let dt = rng.below(400 * DAY);
        cases.push(accrue_case(pool, rates, dt));
    }
    cases
}

fn deposit_case(amount: u64, tranche_assets: u64, supply: u64) -> Value {
    let mut case =
        json!({ "amount": s(amount), "trancheAssets": s(tranche_assets), "supply": s(supply) });
    match shares_for_deposit(amount, tranche_assets, supply) {
        Ok(shares) => case["shares"] = s(shares),
        Err(err) => case["error"] = json!(error_name(&err)),
    }
    case
}

fn deposit_cases() -> Vec<Value> {
    let mut cases = vec![
        deposit_case(1_000, 0, 0),
        deposit_case(1_000, 2_000, 1_000),
        deposit_case(2_500_000_000, 75_308_219_178, 75_000_000_000),
        deposit_case(2_500_000_000, 25_283_561_644, 25_000_000_000),
        // Внесок, що округлюється до нуля часток: програма відмовляє на `shares > 0`.
        deposit_case(1, 3_000, 1_000),
        deposit_case(1_000, 0, 1_000),
        deposit_case(u64::MAX, u64::MAX, u64::MAX),
        deposit_case(u64::MAX, 1, u64::MAX),
    ];
    let mut rng = Rng(0x4445_504f_5349_5401);
    for _ in 0..20 {
        let p = random_pool(&mut rng);
        let (a, sup) = if rng.below(2) == 0 {
            (p.senior_assets, p.senior_supply)
        } else {
            (p.junior_assets, p.junior_supply)
        };
        cases.push(deposit_case(rng.below(50_000_000_000) + 1, a, sup));
    }
    cases
}

fn redeem_case(shares: u64, tranche_assets: u64, supply: u64) -> Value {
    let mut case =
        json!({ "shares": s(shares), "trancheAssets": s(tranche_assets), "supply": s(supply) });
    match amount_for_redeem(shares, tranche_assets, supply) {
        Ok(amount) => case["amount"] = s(amount),
        Err(err) => case["error"] = json!(error_name(&err)),
    }
    case
}

fn redeem_cases() -> Vec<Value> {
    let mut cases = vec![
        redeem_case(500, 2_000, 1_000),
        redeem_case(0, 0, 0),
        redeem_case(2, 10, 1),
        redeem_case(1_000, 0, 1_000),
        redeem_case(10_000_000_000, 75_308_219_178, 75_000_000_000),
        redeem_case(5_000_000_000, 25_283_561_644, 25_000_000_000),
        // Частки, що коштують нуль: програма відмовляє на `amount > 0`.
        redeem_case(1, 1, 1_000),
        redeem_case(u64::MAX, u64::MAX, u64::MAX),
    ];
    let mut rng = Rng(0x5245_4445_454d_0002);
    for _ in 0..20 {
        let p = random_pool(&mut rng);
        let (a, sup) = if rng.below(2) == 0 {
            (p.senior_assets, p.senior_supply)
        } else {
            (p.junior_assets, p.junior_supply)
        };
        cases.push(redeem_case(rng.below(sup + 1), a, sup));
    }
    cases
}

fn subordination_cases() -> Vec<Value> {
    let mut cases: Vec<(u64, u64, u16)> = vec![
        (80, 20, 2_000),
        (81, 19, 2_000),
        (0, 0, 2_000),
        (u64::MAX, u64::MAX, 5_000),
        (100, 0, 0),
        (0, 1, 10_000),
        (1, 0, 10_000),
        // Точки з брифу M0: 25 000 senior — можна, 26 000 — ні.
        (100_308_219_178, 25_283_561_644, 2_000),
        (101_308_219_178, 25_283_561_644, 2_000),
    ];
    let mut rng = Rng(0x5355_424f_5244_0003);
    for _ in 0..20 {
        let p = random_pool(&mut rng);
        cases.push((p.senior_assets, p.junior_assets, rng.below(5_001) as u16));
    }
    cases
        .into_iter()
        .map(|(senior, junior, min_bps)| {
            json!({
                "seniorAfter": s(senior),
                "juniorAfter": s(junior),
                "minBps": min_bps,
                "ok": subordination_ok(senior, junior, min_bps),
            })
        })
        .collect()
}

fn loss_case(pool: PoolBalances, loss_bps: u16) -> Value {
    let loss = loss_amount(pool.assets, loss_bps).unwrap();
    let mut case = json!({ "pool": pool_json(&pool), "lossBps": loss_bps, "loss": s(loss) });
    match apply_loss(loss, pool.senior_assets, pool.junior_assets) {
        Ok(split) => {
            case["juniorLoss"] = s(split.junior_loss);
            case["seniorLoss"] = s(split.senior_loss);
            case["after"] = pool_json(&pool.after_loss(&split).unwrap());
        }
        Err(err) => case["error"] = json!(error_name(&err)),
    }
    case
}

fn loss_cases() -> Vec<Value> {
    let demo_after = demo_pool()
        .after_accrual(&accrue(&demo_pool(), &demo_rates(), 30 * DAY).unwrap())
        .unwrap();
    let mut cases = vec![
        // Демо: 15 % збитку лягає на junior, senior байт у байт той самий.
        loss_case(demo_after, 1_500),
        loss_case(demo_pool(), 3_000),
        loss_case(demo_pool(), 0),
        loss_case(demo_pool(), 10_000),
        loss_case(demo_pool(), 2_500),
        loss_case(demo_pool(), 2_501),
        loss_case(PoolBalances::default(), 1_500),
    ];
    let mut rng = Rng(0x4c4f_5353_0000_0004);
    for _ in 0..20 {
        cases.push(loss_case(random_pool(&mut rng), rng.below(10_001) as u16));
    }
    cases
}

// `init_protection` and `create_pool` give only the demo rates; rewriting them is
// cheaper than a pool per scenario, and the real `accrue` then runs on them.
fn seed_pool_rates(session: &mut Session, p: &PoolSetup, rates: &Rates) {
    let mut account = session.get(&p.pool);
    let mut pool = pool_state(&[(p.pool, account.clone())], &p.pool);
    pool.yield_rate_bps = rates.yield_bps;
    pool.senior_rate_bps = rates.senior_bps;
    pool.perf_fee_bps = rates.fee_bps;
    let mut data = Vec::new();
    pool.try_serialize(&mut data).unwrap();
    account.data = data;
    session.set(p.pool, account);
}

fn pool_balances(session: &Session, p: &PoolSetup) -> PoolBalances {
    let snapshot = session.snapshot();
    let pool = pool_state(&snapshot, &p.pool);
    PoolBalances {
        assets: pool.assets,
        senior_assets: pool.senior_assets,
        junior_assets: pool.junior_assets,
        senior_supply: mint_supply(&snapshot, &p.senior_mint),
        junior_supply: mint_supply(&snapshot, &p.junior_mint),
    }
}

// A pool with assets: `record_loss` refuses an empty one with `ZeroAmount`, and that
// refusal is not a forecast. One in eight has no junior at all.
fn scenario_pool(rng: &mut Rng) -> PoolBalances {
    loop {
        let junior_supply = if rng.below(8) == 0 {
            0
        } else {
            1 + rng.below(80_000_000_000)
        };
        let junior_assets = rng.below(junior_supply + junior_supply / 2 + 1);
        let senior_supply = rng.below(200_000_000_000);
        let senior_assets = if senior_supply == 0 {
            0
        } else {
            senior_supply + rng.below(senior_supply / 4 + 1)
        };
        let pool = PoolBalances {
            assets: senior_assets + junior_assets,
            senior_assets,
            junior_assets,
            senior_supply,
            junior_supply,
        };
        if pool.assets >= 1_000_000 {
            return pool;
        }
    }
}

// Exactly on a bought contract's trigger now and then: the trigger is inclusive, and
// a random loss would never land on it.
fn scenario_loss_bps(rng: &mut Rng, triggers: &[u16]) -> u16 {
    match rng.below(5) {
        0 if !triggers.is_empty() => triggers[rng.below(triggers.len() as u64) as usize].max(1),
        1 => 10_000,
        _ => 1 + rng.below(10_000) as u16,
    }
}

struct Market {
    session: Session,
    cfg: ConfigSetup,
    p: PoolSetup,
    pr: ProtectionSetup,
    slot: u64,
    ts: i64,
    nonce: u64,
}

impl Market {
    fn advance(&mut self, seconds: u64) {
        self.slot += 1;
        self.ts += seconds as i64;
        self.session.harness.warp(self.slot, self.ts);
    }

    // A buy with its own trigger, rate and fee. A premium that rounds to zero at a
    // non-zero rate is refused by the program; such a contract simply is not part
    // of the scenario.
    fn try_buy(&mut self, rng: &mut Rng) -> Option<u64> {
        let micro = rng.below(6) == 0;
        let rate = if micro || rng.below(4) == 0 {
            0
        } else {
            1 + rng.below(2_000) as u16
        };
        seed_protection_rates(
            &mut self.session,
            &self.pr,
            rate,
            rng.below(3_001) as u16,
            rng.below(2_001) as u16,
        );
        let protection = protection_state(&self.session.snapshot(), &self.pr.protection);
        let free = protection.collateral - protection.reserved;
        if free == 0 {
            return None;
        }
        // A notional of a few micro-units pays out zero on most losses.
        let notional = if micro {
            1 + rng.below(10)
        } else {
            1 + rng.below(free)
        }
        .min(free);
        let term = DAY + rng.below(120 * DAY);
        let nonce = self.nonce;
        let result = self.session.run(
            &buy_protection(&self.cfg, &self.p, &self.pr, USER_B, notional, term, nonce),
            &[],
        );
        if result.raw_result.is_err() {
            return None;
        }
        self.nonce += 1;
        Some(nonce)
    }
}

// The refusal by the name the TS mirror throws; anything else is a broken scenario.
fn refusal(session: &Session) -> &'static str {
    let logs = session.logs();
    for name in [
        "ContractNotActive",
        "LossOutsideTerm",
        "LossBelowTrigger",
        "ZeroAmount",
    ] {
        let needle = format!("Error Code: {name}.");
        if logs.iter().any(|l| l.contains(&needle)) {
            return name;
        }
    }
    panic!("unexpected settle refusal: {logs:?}")
}

fn protection_json(session: &Session, pr: &ProtectionSetup) -> Value {
    let protection = protection_state(&session.snapshot(), &pr.protection);
    json!({ "collateral": s(protection.collateral), "reserved": s(protection.reserved) })
}

fn scenario(n: u64) -> Value {
    let mut rng = Rng(0x5343_454e_4152_494f ^ (n + 1).wrapping_mul(0x9e37_79b9_7f4a_7c15));
    let (mut session, cfg, p, pr) = protection_session();
    let rates = random_rates(&mut rng);
    seed_pool_rates(&mut session, &p, &rates);
    seed_pool_state(&mut session, &p, &scenario_pool(&mut rng));

    let collateral = 1_000_000_000 + rng.below(50_000_000_000);
    fund_user(&mut session, &cfg, USER_A, collateral);
    session.run(
        &provide_protection(&cfg, &p, &pr, USER_A, collateral),
        &[Check::success()],
    );
    // Premiums of earlier contracts already in the collateral: a share worth more than 1.
    let grown = collateral + rng.below(collateral / 5 + 1);
    seed_protection_state(&mut session, &pr, grown, 0, collateral);
    fund_user(&mut session, &cfg, USER_B, BUYER_FUNDS);

    let mut m = Market {
        session,
        cfg,
        p,
        pr,
        slot: 1,
        ts: GENESIS_TS,
        nonce: 0,
    };
    let mut nonces = Vec::new();
    for _ in 0..1 + rng.below(4) {
        let wait = rng.below(30);
        m.advance(wait);
        nonces.extend(m.try_buy(&mut rng));
    }
    // Up to 40 model days at the demo scale: some terms run out before the loss.
    let wait = rng.below(80);
    m.advance(wait);

    let before = pool_balances(&m.session, &m.p);
    let model_before = pool_state(&m.session.snapshot(), &m.p.pool).model_time;
    let triggers: Vec<u16> = nonces
        .iter()
        .map(|&nonce| {
            contract_state(
                &m.session.snapshot(),
                &pda::contract(&m.p.pool, &USER_B, nonce).0,
            )
            .trigger_bps
        })
        .collect();
    let loss_bps = scenario_loss_bps(&mut rng, &triggers);
    let ix = record_loss(&m.session, &m.cfg, &m.p, OPERATOR, loss_bps);
    m.session.run(&ix, &[Check::success()]);
    let index = pool_state(&m.session.snapshot(), &m.p.pool).loss_count - 1;
    let event = loss_event_state(&m.session.snapshot(), &pda::loss_event(&m.p.pool, index).0);
    let after = pool_balances(&m.session, &m.p);
    assert_pool_invariant(&m.session.snapshot(), &m.p.pool);

    // A contract bought after the event: its `loss_index_from` is past it.
    if rng.below(4) == 0 {
        nonces.extend(m.try_buy(&mut rng));
    }
    let contracts: Vec<Value> = nonces
        .iter()
        .map(|&nonce| {
            let c = contract_state(
                &m.session.snapshot(),
                &pda::contract(&m.p.pool, &USER_B, nonce).0,
            );
            json!({
                "notional": s(c.notional),
                "triggerBps": c.trigger_bps,
                "lossIndexFrom": c.loss_index_from,
                "expiryModelTime": s(c.expiry_model_time),
            })
        })
        .collect();
    let protection = protection_json(&m.session, &m.pr);

    let mut order: Vec<usize> = (0..nonces.len()).collect();
    for i in (1..order.len()).rev() {
        order.swap(i, rng.below(i as u64 + 1) as usize);
    }
    // A second claim on one of them: refused, whatever the first one did.
    if !order.is_empty() && rng.below(2) == 0 {
        order.push(order[rng.below(order.len() as u64) as usize]);
    }
    let wallet = ata(&USER_B, &m.cfg.mint);
    let settlements: Vec<Value> = order
        .iter()
        .map(|&i| {
            let paid_before = token_amount(&m.session.snapshot(), &wallet);
            let result = m.session.run(
                &settle_protection(&m.cfg, &m.p, &m.pr, USER_B, nonces[i], index),
                &[],
            );
            if result.raw_result.is_err() {
                return json!({ "contract": i, "error": refusal(&m.session) });
            }
            let paid = token_amount(&m.session.snapshot(), &wallet) - paid_before;
            let contract = contract_state(
                &m.session.snapshot(),
                &pda::contract(&m.p.pool, &USER_B, nonces[i]).0,
            );
            assert_eq!(
                contract.payout, paid,
                "the payout field is what was transferred"
            );
            json!({ "contract": i, "payout": s(paid) })
        })
        .collect();
    assert_protection_invariant(&m.session.snapshot(), &m.pr.protection);

    json!({
        "pool": pool_json(&before),
        "rates": rates_json(&rates),
        "dtModel": s(event.model_time - model_before),
        "lossBps": loss_bps,
        "event": {
            "index": event.index,
            "modelTime": s(event.model_time),
            "amount": s(event.amount),
            "juniorLoss": s(event.junior_loss),
            "seniorLoss": s(event.senior_loss),
        },
        "after": pool_json(&after),
        "protection": protection,
        "contracts": contracts,
        "settlements": settlements,
        "protectionAfter": protection_json(&m.session, &m.pr),
    })
}

fn scenario_cases() -> Vec<Value> {
    (0..SCENARIOS).map(scenario).collect()
}

// The scenarios run on the SVM: built once per test binary, not once per test.
fn fixture() -> &'static Value {
    static FIXTURE: OnceLock<Value> = OnceLock::new();
    FIXTURE.get_or_init(|| {
        json!({
            "comment": "Згенеровано `cargo test --workspace -- --ignored gen_waterfall_fixture` (wsl-build.sh fixtures). Не правити руками: waterfall.test.ts проганяє кожен вхід через packages/shared/src/waterfall.ts і звіряє результат. Усі u64 — рядками. `scenarios` — справжні record_loss і settle_protection у mollusk.",
            "accrue": accrue_cases(),
            "deposit": deposit_cases(),
            "redeem": redeem_cases(),
            "subordination": subordination_cases(),
            "loss": loss_cases(),
            "scenarios": scenario_cases(),
        })
    })
}

#[test]
#[ignore = "генератор фікстури: wsl-build.sh fixtures"]
fn gen_waterfall_fixture() {
    let text = serde_json::to_string_pretty(fixture()).unwrap() + "\n";
    std::fs::write(fixture_path(), text).unwrap();
}

// Формула змінилась у `math.rs`, а TS далі зеленіє проти старих чисел — цей тест
// тримає фікстуру прив'язаною до коду.
#[test]
fn waterfall_fixture_matches_math() {
    let path = fixture_path();
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("{}: {e} — wsl-build.sh fixtures", path.display()));
    let stored: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(
        &stored,
        fixture(),
        "fixtures/waterfall.json застаріла — wsl-build.sh fixtures"
    );
}

// Кожна гілка формул має бути у фікстурі хоч раз — інакше TS-дзеркало проходить
// тест, не торкнувшись гілки.
#[test]
fn fixture_covers_every_branch() {
    let f = fixture();
    let has = |section: &str, pred: &dyn Fn(&Value) -> bool| {
        f[section].as_array().unwrap().iter().any(pred)
    };
    assert!(has("deposit", &|c| c["error"] == "TrancheWipedOut"));
    assert!(has("deposit", &|c| c["shares"] == "0"));
    assert!(has("redeem", &|c| c["error"] == "TrancheWipedOut"));
    assert!(has("redeem", &|c| c["error"] == "ParameterOutOfRange"));
    assert!(has("redeem", &|c| c["amount"] == "0"));
    assert!(has("subordination", &|c| c["ok"] == false));
    assert!(has("loss", &|c| c["seniorLoss"] != "0"
        && c["seniorLoss"] != Value::Null));
    assert!(has("loss", &|c| c["seniorLoss"] == "0"
        && c["juniorLoss"] != "0"));
    assert!(has("accrue", &|c| c["accrual"]["juniorGain"] == "0"
        && c["accrual"]["seniorGain"] != "0"));
    assert!(has("accrue", &|c| c["accrual"]["seniorGain"] == "0"
        && c["accrual"]["juniorGain"] != "0"));

    assert!(has("scenarios", &|c| c["event"]["seniorLoss"] != "0"));
    assert!(has("scenarios", &|c| c["event"]["seniorLoss"] == "0"));
    assert!(has("scenarios", &|c| c["dtModel"] != "0"));
    let steps: Vec<&Value> = f["scenarios"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|c| c["settlements"].as_array().unwrap())
        .collect();
    let refused = |name: &str| steps.iter().filter(|s| s["error"] == name).count();
    for name in [
        "ContractNotActive",
        "LossOutsideTerm",
        "LossBelowTrigger",
        "ZeroAmount",
    ] {
        assert!(refused(name) > 0, "no scenario refuses with {name}");
    }
    // Both bounds of the term: the late buy and an expiry before the event.
    let scenarios = f["scenarios"].as_array().unwrap();
    assert!(scenarios.iter().any(|c| c["contracts"]
        .as_array()
        .unwrap()
        .iter()
        .any(|k| k["lossIndexFrom"] != 0)));
    assert!(scenarios.iter().any(|c| {
        let event_time: u64 = c["event"]["modelTime"].as_str().unwrap().parse().unwrap();
        c["contracts"].as_array().unwrap().iter().any(|k| {
            k["expiryModelTime"]
                .as_str()
                .unwrap()
                .parse::<u64>()
                .unwrap()
                < event_time
        })
    }));
    assert!(
        scenarios.iter().any(|c| c["settlements"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["payout"].is_string()
                && c["contracts"][s["contract"].as_u64().unwrap() as usize]["triggerBps"]
                    == c["lossBps"])),
        "no payout lands exactly on the trigger"
    );
    // The forecast is about payouts: a fixture of refusals alone would be green and empty.
    let paid = steps.iter().filter(|s| s["payout"].is_string()).count();
    assert!(
        paid * 3 >= steps.len(),
        "only {paid} of {} settlements paid out",
        steps.len()
    );
}
