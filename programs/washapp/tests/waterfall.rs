// Фікстура для TS-дзеркала `math.rs` (`packages/shared/src/waterfall.ts`):
// нарахування, частки при депозиті, сума при погашенні, субординація, waterfall
// збитку. Генерується з Rust і комітиться; `waterfall.test.ts` проганяє ті самі
// входи через TS і звіряє кожне число байт у байт (PLAN, ризик #9). Сторож
// нижче валить `cargo test`, коли формула змінилась, а фікстура — ні.
use std::path::PathBuf;

use anchor_lang::error::Error;
use serde_json::{json, Value};
use washapp::errors::WashError;
use washapp::math::{
    accrue, amount_for_redeem, apply_loss, loss_amount, shares_for_deposit, subordination_ok,
    PoolBalances, Rates,
};

const DAY: u64 = 86_400;
const DEMO_SCALE: u64 = 43_200;

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

fn fixture() -> Value {
    json!({
        "comment": "Згенеровано `cargo test --workspace -- --ignored gen_waterfall_fixture` (wsl-build.sh fixtures). Не правити руками: waterfall.test.ts проганяє кожен вхід через packages/shared/src/waterfall.ts і звіряє результат. Усі u64 — рядками.",
        "accrue": accrue_cases(),
        "deposit": deposit_cases(),
        "redeem": redeem_cases(),
        "subordination": subordination_cases(),
        "loss": loss_cases(),
    })
}

#[test]
#[ignore = "генератор фікстури: wsl-build.sh fixtures"]
fn gen_waterfall_fixture() {
    let text = serde_json::to_string_pretty(&fixture()).unwrap() + "\n";
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
        stored,
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
}
