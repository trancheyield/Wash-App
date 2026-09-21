// Чиста математика пулу: нарахування доходу, частки траншів, waterfall збитку,
// субординація. Без акаунтів і CPI — інструкції зчитують стан, кличуть ці функції
// і записують результат. Дзеркало у TypeScript — `packages/shared/src/waterfall.ts`,
// обидва проходять `fixtures/waterfall.json`.
//
// Усі проміжні добутки — `u128`, ділення — вниз. Залишок округлення доходу лягає в
// junior; при збитку senior не зачіпається, поки junior не вичерпано (SC-003).
use anchor_lang::prelude::*;

use crate::constants::{BPS_DENOMINATOR, YEAR_SECONDS};
use crate::errors::WashError;

const BPS: u128 = BPS_DENOMINATOR as u128;
const YEAR: u128 = YEAR_SECONDS as u128;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tranche {
    Senior,
    Junior,
}

// Облікові величини пулу, які змінює кожна інструкція. Інваріант
// `assets == senior_assets + junior_assets` тримають методи `after_*`: вони
// зсувають усі три поля з одних і тих самих доданків.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PoolBalances {
    pub assets: u64,
    pub senior_assets: u64,
    pub junior_assets: u64,
    pub senior_supply: u64,
    pub junior_supply: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rates {
    pub yield_bps: u16,
    pub senior_bps: u16,
    pub fee_bps: u16,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Accrual {
    pub yield_amount: u64,
    pub fee: u64,
    pub senior_gain: u64,
    pub junior_gain: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct LossSplit {
    pub junior_loss: u64,
    pub senior_loss: u64,
}

// `amount × rate_bps × dt / (BPS × YEAR)` — річна ставка за модельний проміжок.
fn pro_rata(amount: u64, rate_bps: u16, dt_model: u64) -> Result<u64> {
    let product = (amount as u128)
        .checked_mul(rate_bps as u128)
        .and_then(|p| p.checked_mul(dt_model as u128))
        .ok_or(WashError::Overflow)?;
    to_u64(product / (BPS * YEAR))
}

fn mul_bps(amount: u64, bps: u16) -> Result<u64> {
    to_u64((amount as u128) * (bps as u128) / BPS)
}

fn mul_div(a: u64, b: u64, d: u64) -> Result<u64> {
    to_u64((a as u128) * (b as u128) / (d as u128))
}

fn to_u64(v: u128) -> Result<u64> {
    u64::try_from(v).map_err(|_| WashError::Overflow.into())
}

// Дохід за `dt_model` модельних секунд: комісія — з доходу, senior — не більше
// своєї ставки від своїх активів, решта — junior. Порожній транш (supply = 0)
// доходу не отримує; порожній пул доходу не дає.
pub fn accrue(pool: &PoolBalances, rates: &Rates, dt_model: u64) -> Result<Accrual> {
    if pool.senior_supply == 0 && pool.junior_supply == 0 {
        return Ok(Accrual::default());
    }
    let yield_amount = pro_rata(pool.assets, rates.yield_bps, dt_model)?;
    let fee = mul_bps(yield_amount, rates.fee_bps)?;
    let net = yield_amount.checked_sub(fee).ok_or(WashError::Overflow)?;
    let senior_gain = if pool.junior_supply == 0 {
        net
    } else if pool.senior_supply == 0 {
        0
    } else {
        pro_rata(pool.senior_assets, rates.senior_bps, dt_model)?.min(net)
    };
    Ok(Accrual {
        yield_amount,
        fee,
        senior_gain,
        junior_gain: net - senior_gain,
    })
}

// 1:1 для першого вкладника. Транш із частками, але без активів (вичерпаний
// збитком) не приймає депозитів — новий внесок розділився б зі старими держателями.
pub fn shares_for_deposit(amount: u64, tranche_assets: u64, supply: u64) -> Result<u64> {
    if supply == 0 {
        return Ok(amount);
    }
    require!(tranche_assets > 0, WashError::TrancheWipedOut);
    mul_div(amount, supply, tranche_assets)
}

pub fn amount_for_redeem(shares: u64, tranche_assets: u64, supply: u64) -> Result<u64> {
    require!(shares <= supply, WashError::ParameterOutOfRange);
    if supply == 0 {
        return Ok(0);
    }
    require!(tranche_assets > 0, WashError::TrancheWipedOut);
    mul_div(shares, tranche_assets, supply)
}

pub fn loss_amount(assets: u64, loss_bps: u16) -> Result<u64> {
    mul_bps(assets, loss_bps)
}

// Частки продавців захисту — ті самі правила, що й у траншів: 1:1 для першого,
// далі за вартістю; забезпечення, вичерпане виплатами при живих частках, нових
// внесків не приймає — інакше внесок розділився б зі старими держателями.
pub fn shares_for_collateral(amount: u64, collateral: u64, share_supply: u64) -> Result<u64> {
    if share_supply == 0 {
        return Ok(amount);
    }
    require!(collateral > 0, WashError::CollateralWipedOut);
    mul_div(amount, share_supply, collateral)
}

pub fn collateral_for_shares(shares: u64, collateral: u64, share_supply: u64) -> Result<u64> {
    require!(shares <= share_supply, WashError::ParameterOutOfRange);
    if share_supply == 0 {
        return Ok(0);
    }
    require!(collateral > 0, WashError::CollateralWipedOut);
    mul_div(shares, collateral, share_supply)
}

// Waterfall: спочатку junior, лише його вичерпання доходить до senior.
pub fn apply_loss(loss: u64, senior_assets: u64, junior_assets: u64) -> Result<LossSplit> {
    let junior_loss = loss.min(junior_assets);
    let senior_loss = loss - junior_loss;
    require!(senior_loss <= senior_assets, WashError::ParameterOutOfRange);
    Ok(LossSplit {
        junior_loss,
        senior_loss,
    })
}

// Частка junior в активах після операції не нижча за мінімум; порожній пул
// обмеження не порушує.
pub fn subordination_ok(senior_after: u64, junior_after: u64, min_bps: u16) -> bool {
    let total = senior_after as u128 + junior_after as u128;
    (junior_after as u128) * BPS >= (min_bps as u128) * total
}

impl PoolBalances {
    pub fn tranche(&self, tranche: Tranche) -> (u64, u64) {
        match tranche {
            Tranche::Senior => (self.senior_assets, self.senior_supply),
            Tranche::Junior => (self.junior_assets, self.junior_supply),
        }
    }

    pub fn after_accrual(&self, accrual: &Accrual) -> Result<Self> {
        let senior_assets = add(self.senior_assets, accrual.senior_gain)?;
        let junior_assets = add(self.junior_assets, accrual.junior_gain)?;
        let net = add(accrual.senior_gain, accrual.junior_gain)?;
        Ok(Self {
            assets: add(self.assets, net)?,
            senior_assets,
            junior_assets,
            ..*self
        })
    }

    pub fn after_deposit(&self, tranche: Tranche, amount: u64, shares: u64) -> Result<Self> {
        let mut next = *self;
        next.assets = add(self.assets, amount)?;
        match tranche {
            Tranche::Senior => {
                next.senior_assets = add(self.senior_assets, amount)?;
                next.senior_supply = add(self.senior_supply, shares)?;
            }
            Tranche::Junior => {
                next.junior_assets = add(self.junior_assets, amount)?;
                next.junior_supply = add(self.junior_supply, shares)?;
            }
        }
        Ok(next)
    }

    pub fn after_redeem(&self, tranche: Tranche, shares: u64, amount: u64) -> Result<Self> {
        let mut next = *self;
        next.assets = sub(self.assets, amount)?;
        match tranche {
            Tranche::Senior => {
                next.senior_assets = sub(self.senior_assets, amount)?;
                next.senior_supply = sub(self.senior_supply, shares)?;
            }
            Tranche::Junior => {
                next.junior_assets = sub(self.junior_assets, amount)?;
                next.junior_supply = sub(self.junior_supply, shares)?;
            }
        }
        Ok(next)
    }

    pub fn after_loss(&self, split: &LossSplit) -> Result<Self> {
        let loss = add(split.senior_loss, split.junior_loss)?;
        Ok(Self {
            assets: sub(self.assets, loss)?,
            senior_assets: sub(self.senior_assets, split.senior_loss)?,
            junior_assets: sub(self.junior_assets, split.junior_loss)?,
            ..*self
        })
    }
}

fn add(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b).ok_or_else(|| WashError::Overflow.into())
}

fn sub(a: u64, b: u64) -> Result<u64> {
    a.checked_sub(b).ok_or_else(|| WashError::Overflow.into())
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use anchor_lang::error::Error;
    use proptest::prelude::*;

    use super::*;
    use proptest::test_runner::{Config, TestRunner};

    const DAY: u64 = 86_400;
    // Стеля сум у послідовностях: 10⁹ токенів по 6 знаків — 10⁶ вкладників
    // демо-розміру. Межі `u64` перевіряє окремий тест без панік.
    const MAX_AMOUNT: u64 = 1_000_000_000_000_000;

    fn is(err: &Error, code: WashError) -> bool {
        *err == Error::from(code)
    }

    // Демо-параметри — одне джерело з брифом M0 і `tools/demo`; очікувані числа
    // збігаються з `apps/web/src/mock/data.ts` (`accrualSummary`).
    fn demo_rates() -> Rates {
        let params: serde_json::Value =
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

    #[test]
    fn accrual_matches_m0_brief_after_30_model_days() {
        let accrual = accrue(&demo_pool(), &demo_rates(), 30 * DAY).unwrap();
        assert_eq!(
            accrual,
            Accrual {
                yield_amount: 657_534_246,
                fee: 65_753_424,
                senior_gain: 308_219_178,
                junior_gain: 283_561_644,
            }
        );
        let after = demo_pool().after_accrual(&accrual).unwrap();
        assert_eq!(after.senior_assets, 75_308_219_178);
        assert_eq!(after.junior_assets, 25_283_561_644);
        assert_eq!(after.assets, 100_591_780_822);
    }

    #[test]
    fn demo_loss_15pct_is_absorbed_by_junior_alone() {
        let pool = demo_pool()
            .after_accrual(&accrue(&demo_pool(), &demo_rates(), 30 * DAY).unwrap())
            .unwrap();
        let loss = loss_amount(pool.assets, 1_500).unwrap();
        assert_eq!(loss, 15_088_767_123);
        let split = apply_loss(loss, pool.senior_assets, pool.junior_assets).unwrap();
        assert_eq!(split.senior_loss, 0);
        let after = pool.after_loss(&split).unwrap();
        assert_eq!(after.senior_assets, pool.senior_assets);
        assert_eq!(after.junior_assets, 10_194_794_521);
    }

    #[test]
    fn loss_beyond_junior_reaches_senior_by_exactly_the_excess() {
        let pool = demo_pool();
        let loss = loss_amount(pool.assets, 3_000).unwrap();
        let split = apply_loss(loss, pool.senior_assets, pool.junior_assets).unwrap();
        assert_eq!(split.junior_loss, 25_000_000_000);
        assert_eq!(split.senior_loss, 5_000_000_000);
        let err = apply_loss(pool.assets + 1, pool.senior_assets, pool.junior_assets).unwrap_err();
        assert!(is(&err, WashError::ParameterOutOfRange));
    }

    #[test]
    fn senior_cap_binds_only_when_yield_covers_it() {
        // Дохід 1 % річних менший за ставку senior 5 %: усе (після комісії) — senior.
        let rates = Rates {
            yield_bps: 100,
            senior_bps: 500,
            fee_bps: 1_000,
        };
        let a = accrue(&demo_pool(), &rates, 30 * DAY).unwrap();
        assert_eq!(a.junior_gain, 0);
        assert_eq!(a.senior_gain, a.yield_amount - a.fee);
    }

    #[test]
    fn empty_tranche_gets_nothing_and_empty_pool_yields_nothing() {
        let rates = demo_rates();
        let only_senior = PoolBalances {
            junior_assets: 0,
            junior_supply: 0,
            ..demo_pool()
        };
        let a = accrue(&only_senior, &rates, 30 * DAY).unwrap();
        assert_eq!(a.junior_gain, 0);
        assert_eq!(a.senior_gain, a.yield_amount - a.fee);

        let only_junior = PoolBalances {
            senior_assets: 0,
            senior_supply: 0,
            ..demo_pool()
        };
        let a = accrue(&only_junior, &rates, 30 * DAY).unwrap();
        assert_eq!(a.senior_gain, 0);
        assert_eq!(a.junior_gain, a.yield_amount - a.fee);

        assert_eq!(
            accrue(&PoolBalances::default(), &rates, 30 * DAY).unwrap(),
            Accrual::default()
        );
    }

    #[test]
    fn shares_are_one_to_one_first_and_pro_rata_after() {
        assert_eq!(shares_for_deposit(1_000, 0, 0).unwrap(), 1_000);
        assert_eq!(shares_for_deposit(1_000, 2_000, 1_000).unwrap(), 500);
        assert_eq!(amount_for_redeem(500, 2_000, 1_000).unwrap(), 1_000);
        assert_eq!(amount_for_redeem(0, 0, 0).unwrap(), 0);
        let err = amount_for_redeem(2, 10, 1).unwrap_err();
        assert!(is(&err, WashError::ParameterOutOfRange));
    }

    #[test]
    fn wiped_out_tranche_refuses_deposit_and_redeem() {
        let err = shares_for_deposit(1_000, 0, 1_000).unwrap_err();
        assert!(is(&err, WashError::TrancheWipedOut));
        let err = amount_for_redeem(1_000, 0, 1_000).unwrap_err();
        assert!(is(&err, WashError::TrancheWipedOut));
    }

    // Два продавці: другий заходить після того, як премія підняла вартість
    // частки, і отримує пропорційно менше; кожен виходить рівно зі своєю часткою.
    #[test]
    fn collateral_shares_are_one_to_one_first_and_by_value_after() {
        assert_eq!(shares_for_collateral(1_000, 0, 0).unwrap(), 1_000);
        // Премія 100 без нових часток: 1 000 часток коштують 1 100.
        assert_eq!(shares_for_collateral(1_100, 1_100, 1_000).unwrap(), 1_000);
        assert_eq!(collateral_for_shares(1_000, 2_200, 2_000).unwrap(), 1_100);
        assert_eq!(collateral_for_shares(0, 0, 0).unwrap(), 0);
        // Внесок, що дає нуль часток, — на совісті інструкції (`ZeroAmount`).
        assert_eq!(shares_for_collateral(5, 10, 1).unwrap(), 0);
        let err = collateral_for_shares(2, 10, 1).unwrap_err();
        assert!(is(&err, WashError::ParameterOutOfRange));
    }

    #[test]
    fn wiped_out_collateral_refuses_provide_and_withdraw() {
        let err = shares_for_collateral(1_000, 0, 1_000).unwrap_err();
        assert!(is(&err, WashError::CollateralWipedOut));
        let err = collateral_for_shares(1_000, 0, 1_000).unwrap_err();
        assert!(is(&err, WashError::CollateralWipedOut));
    }

    #[test]
    fn subordination_threshold_is_inclusive() {
        assert!(subordination_ok(80, 20, 2_000));
        assert!(!subordination_ok(81, 19, 2_000));
        assert!(subordination_ok(0, 0, 2_000));
        assert!(subordination_ok(u64::MAX, u64::MAX, 5_000));
    }

    #[test]
    fn huge_model_interval_is_an_error_not_a_panic() {
        let rates = demo_rates();
        let pool = PoolBalances {
            assets: u64::MAX,
            senior_assets: u64::MAX,
            senior_supply: 1,
            junior_supply: 1,
            ..Default::default()
        };
        let err = accrue(&pool, &rates, u64::MAX).unwrap_err();
        assert!(is(&err, WashError::Overflow));
    }

    // Модель послідовності інструкцій M1 — те, що робитиме кожен хендлер: accrue,
    // потім операція, кожен крок лишає `PoolBalances` через `after_*`.
    #[derive(Clone, Copy, Debug)]
    enum Op {
        Deposit(Tranche, u64),
        Redeem(Tranche, u16),
        Accrue(u64),
        Loss(u16),
    }

    fn tranche() -> impl Strategy<Value = Tranche> {
        prop_oneof![Just(Tranche::Senior), Just(Tranche::Junior)]
    }

    fn op() -> impl Strategy<Value = Op> {
        prop_oneof![
            (tranche(), 1..=MAX_AMOUNT).prop_map(|(t, a)| Op::Deposit(t, a)),
            (tranche(), 1..=10_000u16).prop_map(|(t, f)| Op::Redeem(t, f)),
            (1..=3_650 * DAY).prop_map(Op::Accrue),
            (0..=10_000u16).prop_map(Op::Loss),
        ]
    }

    fn rates() -> impl Strategy<Value = Rates> {
        (0..=10_000u16, 0..=10_000u16, 0..=10_000u16).prop_map(|(y, s, f)| Rates {
            yield_bps: y,
            senior_bps: s,
            fee_bps: f,
        })
    }

    // Один крок як в інструкції; `None` — інструкція відмовила б (субординація,
    // вичерпаний транш, нуль часток), стан не змінився.
    fn step(
        pool: PoolBalances,
        rates: &Rates,
        op: Op,
        min_junior_bps: u16,
    ) -> Option<PoolBalances> {
        match op {
            Op::Deposit(t, amount) => {
                let (assets, supply) = pool.tranche(t);
                let shares = shares_for_deposit(amount, assets, supply).ok()?;
                let next = pool.after_deposit(t, amount, shares).ok()?;
                let ok = t == Tranche::Junior
                    || subordination_ok(next.senior_assets, next.junior_assets, min_junior_bps);
                ok.then_some(next)
            }
            Op::Redeem(t, fraction_bps) => {
                let (assets, supply) = pool.tranche(t);
                let shares = mul_bps(supply, fraction_bps).ok()?;
                if shares == 0 {
                    return None;
                }
                let amount = amount_for_redeem(shares, assets, supply).ok()?;
                let next = pool.after_redeem(t, shares, amount).ok()?;
                let ok = t == Tranche::Senior
                    || subordination_ok(next.senior_assets, next.junior_assets, min_junior_bps);
                ok.then_some(next)
            }
            Op::Accrue(dt) => pool.after_accrual(&accrue(&pool, rates, dt).ok()?).ok(),
            Op::Loss(bps) => {
                let loss = loss_amount(pool.assets, bps).ok()?;
                let split = apply_loss(loss, pool.senior_assets, pool.junior_assets).ok()?;
                pool.after_loss(&split).ok()
            }
        }
    }

    // SC-002: `senior + junior == assets` після кожного кроку на 1 000 послідовностях.
    // Сторож частки застосованих кроків: властивість «якщо крок пройшов» без нього
    // може зеленіти на послідовностях, де майже все відмовило.
    #[test]
    fn sc002_accounting_invariant_holds_over_1000_sequences() {
        let mut runner = TestRunner::new(Config {
            cases: 1_000,
            source_file: Some(file!()),
            ..Config::default()
        });
        let applied = Cell::new(0u64);
        let attempted = Cell::new(0u64);
        let strategy = (
            rates(),
            0..=5_000u16,
            1..=MAX_AMOUNT,
            1..=MAX_AMOUNT,
            prop::collection::vec(op(), 1..=40),
        );
        runner
            .run(
                &strategy,
                |(rates, min_junior_bps, seed_junior, seed_senior, ops)| {
                    // Пул стартує живим: junior, потім senior — так само робитиме `tools/demo`.
                    let mut pool = PoolBalances::default();
                    for op in [
                        Op::Deposit(Tranche::Junior, seed_junior),
                        Op::Deposit(Tranche::Senior, seed_senior),
                    ]
                    .into_iter()
                    .chain(ops)
                    {
                        attempted.set(attempted.get() + 1);
                        if let Some(next) = step(pool, &rates, op, min_junior_bps) {
                            applied.set(applied.get() + 1);
                            pool = next;
                        }
                        prop_assert_eq!(
                            pool.assets,
                            pool.senior_assets + pool.junior_assets,
                            "після {:?}: {:?}",
                            op,
                            pool
                        );
                    }
                    Ok(())
                },
            )
            .unwrap();
        let (applied, attempted) = (applied.get(), attempted.get());
        eprintln!("SC-002: застосовано {applied} з {attempted} кроків");
        assert!(
            applied * 2 >= attempted,
            "застосовано лише {applied} з {attempted} кроків — послідовності майже порожні"
        );
    }

    proptest! {
        #![proptest_config(ProptestConfig { cases: 500, ..ProptestConfig::default() })]

        // SC-003, обидві гілки, байт-у-байт на `u64`.
        #[test]
        fn sc003_senior_untouched_below_junior_and_exact_excess_above(
            senior in any::<u64>(),
            junior in any::<u64>(),
            fraction in 0..=10_000u16,
        ) {
            // `L ≤ senior + junior`; сума двох `u64` може не вміститись — стеля `u64::MAX`.
            let total = senior as u128 + junior as u128;
            let loss = u64::try_from(total * fraction as u128 / BPS).unwrap_or(u64::MAX);
            let split = apply_loss(loss, senior, junior).unwrap();
            let senior_after = senior - split.senior_loss;
            if loss <= junior {
                prop_assert_eq!(split.senior_loss, 0);
                prop_assert_eq!(senior_after, senior);
                prop_assert_eq!(split.junior_loss, loss);
            } else {
                prop_assert_eq!(split.senior_loss, loss - junior);
                prop_assert_eq!(split.junior_loss, junior);
            }
            prop_assert_eq!(split.senior_loss + split.junior_loss, loss);
        }

        // Залишок округлення доходу — junior: senior отримує рівно свою стелю, коли
        // дохід її покриває, і рівно весь чистий дохід, коли ні.
        #[test]
        fn rounding_remainder_goes_to_junior(
            senior_assets in 0..=MAX_AMOUNT,
            junior_assets in 0..=MAX_AMOUNT,
            rates in rates(),
            dt in 0..=3_650 * DAY,
        ) {
            let pool = PoolBalances {
                assets: senior_assets + junior_assets,
                senior_assets,
                junior_assets,
                senior_supply: 1,
                junior_supply: 1,
            };
            let a = accrue(&pool, &rates, dt).unwrap();
            let net = a.yield_amount - a.fee;
            let cap = pro_rata(senior_assets, rates.senior_bps, dt).unwrap();
            prop_assert_eq!(a.senior_gain, cap.min(net));
            prop_assert_eq!(a.senior_gain + a.junior_gain, net);
            prop_assert!(a.fee <= a.yield_amount);
        }

        // Частки продавців: вихід ніколи не віддає більше, ніж коштує частка,
        // а два продавці ділять забезпечення пропорційно часткам з точністю до
        // округлення вниз — сума виходів не перевищує забезпечення.
        #[test]
        fn collateral_shares_round_trip_never_exceeds_value(
            first in 1..=MAX_AMOUNT,
            premium in 0..=MAX_AMOUNT,
            second in 1..=MAX_AMOUNT,
        ) {
            let s1 = shares_for_collateral(first, 0, 0).unwrap();
            prop_assert_eq!(s1, first);
            let collateral = first + premium;
            let s2 = shares_for_collateral(second, collateral, s1).unwrap();
            prop_assert!(s2 <= second);
            let supply = s1 + s2;
            let collateral = collateral + second;
            let out1 = collateral_for_shares(s1, collateral, supply).unwrap();
            let out2 = collateral_for_shares(s2, collateral, supply).unwrap();
            prop_assert!(out2 <= second);
            prop_assert!(out1 + out2 <= collateral);
            prop_assert!(collateral - (out1 + out2) <= 1);
        }

        // Межі `u64`: будь-який вхід — `Ok` або `Err`, ніколи паніка.
        #[test]
        fn no_panic_anywhere_on_u64_edges(
            a in any::<u64>(), b in any::<u64>(), c in any::<u64>(), d in any::<u64>(), e in any::<u64>(),
            r1 in any::<u16>(), r2 in any::<u16>(), r3 in any::<u16>(),
            dt in any::<u64>(),
        ) {
            let pool = PoolBalances { assets: a, senior_assets: b, junior_assets: c, senior_supply: d, junior_supply: e };
            let rates = Rates { yield_bps: r1, senior_bps: r2, fee_bps: r3 };
            if let Ok(acc) = accrue(&pool, &rates, dt) {
                let _ = pool.after_accrual(&acc);
            }
            let _ = shares_for_deposit(a, b, c);
            let _ = amount_for_redeem(a, b, c);
            let _ = shares_for_collateral(a, b, c);
            let _ = collateral_for_shares(a, b, c);
            if let Ok(split) = apply_loss(a, b, c) {
                let _ = pool.after_loss(&split);
            }
            let _ = loss_amount(a, r1);
            let _ = subordination_ok(a, b, r1);
            let _ = pool.after_deposit(Tranche::Senior, a, b);
            let _ = pool.after_redeem(Tranche::Junior, a, b);
        }
    }
}
