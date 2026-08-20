// Розкладка акаунтів — публічний контракт для Codama-клієнта і `pda.ts`:
// розміри порахувані руками з таблиці PLAN «Модель даних», і будь-яка зміна поля
// має спершу змінити число тут.
use anchor_lang::{AnchorSerialize, Space};
use washapp::constants::*;
use washapp::math::{PoolBalances, Tranche};
use washapp::state::*;

const DISC: usize = 8;

#[test]
fn account_sizes_match_plan_layout() {
    assert_eq!(DISC + Config::INIT_SPACE, 8 + 32 * 3 + 8 + 1);
    assert_eq!(
        DISC + Pool::INIT_SPACE,
        8 + 2 + 32 * 5 + 2 * 4 + 4 + 8 * 3 + 8 + 8 + 4 + 8 + 1
    );
    assert_eq!(
        DISC + LossEvent::INIT_SPACE,
        8 + 32 + 4 + 8 + 8 + 2 + 8 * 4 + 1
    );
    assert_eq!(
        DISC + ProtectionPool::INIT_SPACE,
        8 + 32 * 2 + 2 * 3 + 8 * 4 + 1
    );
    assert_eq!(DISC + SellerPosition::INIT_SPACE, 8 + 32 * 2 + 8 + 1);
    assert_eq!(
        DISC + ProtectionContract::INIT_SPACE,
        8 + 32 * 2 + 8 * 5 + 2 + 4 + 1 + 4 + 8 + 1
    );
}

// Усі акаунти дрібні; ріст понад 256 байт — привід переглянути розкладку, а не
// підняти число: `create_pool` створює п'ять акаунтів в одному кадрі `try_accounts`.
#[test]
fn every_account_is_small() {
    for size in [
        Config::INIT_SPACE,
        Pool::INIT_SPACE,
        LossEvent::INIT_SPACE,
        ProtectionPool::INIT_SPACE,
        SellerPosition::INIT_SPACE,
        ProtectionContract::INIT_SPACE,
    ] {
        assert!(size < 256, "{size}");
    }
}

// Seeds — префікси PDA; два однакові дали б колізію адрес між типами акаунтів.
#[test]
fn seeds_are_distinct_and_ascii() {
    let all: [&[u8]; 12] = [
        CONFIG_SEED,
        MINT_SEED,
        TREASURY_SEED,
        POOL_SEED,
        VAULT_SEED,
        SENIOR_MINT_SEED,
        JUNIOR_MINT_SEED,
        LOSS_SEED,
        PROTECTION_SEED,
        PVAULT_SEED,
        SELLER_SEED,
        CONTRACT_SEED,
    ];
    for (i, a) in all.iter().enumerate() {
        assert!(a.is_ascii() && !a.is_empty() && a.len() <= 32);
        for b in &all[i + 1..] {
            assert_ne!(a, b);
        }
    }
    assert_eq!(Config::SEED, CONFIG_SEED);
    assert_eq!(Pool::SEED, POOL_SEED);
    assert_eq!(LossEvent::SEED, LOSS_SEED);
    assert_eq!(ProtectionPool::SEED, PROTECTION_SEED);
    assert_eq!(SellerPosition::SEED, SELLER_SEED);
    assert_eq!(ProtectionContract::SEED, CONTRACT_SEED);
}

// Байти enum-ів — те, що побачить TS-клієнт: порядок варіантів фіксований.
fn borsh(value: &impl AnchorSerialize) -> Vec<u8> {
    let mut bytes = Vec::new();
    value.serialize(&mut bytes).unwrap();
    bytes
}

#[test]
fn enums_encode_as_stable_bytes() {
    assert_eq!(borsh(&ContractStatus::Active), [0]);
    assert_eq!(borsh(&ContractStatus::Settled), [1]);
    assert_eq!(borsh(&ContractStatus::Expired), [2]);
    assert_eq!(borsh(&Tranche::Senior), [0]);
    assert_eq!(borsh(&Tranche::Junior), [1]);
}

#[test]
fn parameter_bounds_keep_pro_rata_inside_u128() {
    // Найгірший добуток `assets × bps × dt` за 10 модельних років на максимальному
    // масштабі має вміщатись у `u128` — інакше `accrue` відмовляв би на живому пулі.
    let worst = (u64::MAX as u128)
        .checked_mul(MAX_BPS as u128)
        .and_then(|p| p.checked_mul(MAX_TERM_SECONDS as u128 * MAX_TIME_SCALE as u128));
    assert!(worst.is_some());
    assert_eq!(MAX_BPS as u64, BPS_DENOMINATOR);
    assert_eq!(MAX_TERM_SECONDS, 10 * YEAR_SECONDS);
}

#[test]
fn pool_balances_round_trip_leaves_supply_to_mints() {
    let mut pool = Pool {
        id: 0,
        operator: Default::default(),
        mint: Default::default(),
        vault: Default::default(),
        senior_mint: Default::default(),
        junior_mint: Default::default(),
        yield_rate_bps: 800,
        senior_rate_bps: 500,
        min_junior_bps: 2_000,
        perf_fee_bps: 1_000,
        time_scale: 43_200,
        assets: 100,
        senior_assets: 75,
        junior_assets: 25,
        model_time: 0,
        last_accrued_ts: 0,
        loss_count: 0,
        created_at: 0,
        bump: 255,
    };
    let balances = pool.balances(75, 25);
    assert_eq!(
        balances,
        PoolBalances {
            assets: 100,
            senior_assets: 75,
            junior_assets: 25,
            senior_supply: 75,
            junior_supply: 25,
        }
    );
    let next = balances.after_deposit(Tranche::Junior, 10, 10).unwrap();
    pool.set_balances(&next);
    assert_eq!(
        (pool.assets, pool.senior_assets, pool.junior_assets),
        (110, 75, 35)
    );
    assert_eq!(pool.rates().fee_bps, 1_000);
}
