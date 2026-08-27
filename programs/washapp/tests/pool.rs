mod common;

use anchor_lang::Space;
use common::{
    account_of, assert_pool_invariant, configured_session, create_pool, demo_params, mint_supply,
    pool_session, pool_setup, pool_state, signer_account, token_amount, GENESIS_TS, USER_A,
};
use mollusk_svm::result::Check;
use solana_program_option::COption;
use solana_program_pack::Pack;
use solana_pubkey::Pubkey;
use spl_token_interface::state::{Account as TokenAccount, Mint};
use washapp::constants::{DEMO_MINT_DECIMALS, MAX_BPS, MAX_TIME_SCALE};
use washapp::instructions::PoolParams;
use washapp::state::Pool;

#[test]
fn create_pool_stores_params_and_links_vault_and_tranches() {
    let (session, s, p) = pool_session();
    let after = session.snapshot();

    let raw = account_of(&after, &p.pool);
    assert_eq!(raw.owner, washapp::ID);
    assert_eq!(raw.data.len(), 8 + Pool::INIT_SPACE);

    let pool = pool_state(&after, &p.pool);
    assert_eq!(pool.id, p.id);
    assert_eq!(pool.operator, s.authority);
    assert_eq!(pool.mint, s.mint);
    assert_eq!(pool.vault, p.vault);
    assert_eq!(pool.senior_mint, p.senior_mint);
    assert_eq!(pool.junior_mint, p.junior_mint);
    assert_eq!(pool.yield_rate_bps, p.params.yield_rate_bps);
    assert_eq!(pool.senior_rate_bps, p.params.senior_rate_bps);
    assert_eq!(pool.min_junior_bps, p.params.min_junior_bps);
    assert_eq!(pool.perf_fee_bps, p.params.perf_fee_bps);
    assert_eq!(pool.time_scale, p.params.time_scale);
    assert_eq!(pool.bump, p.bump);
    assert_eq!(
        (pool.assets, pool.senior_assets, pool.junior_assets),
        (0, 0, 0)
    );
    assert_eq!((pool.model_time, pool.loss_count), (0, 0));
    // Модельний годинник стартує з моменту створення, не з нуля.
    assert_eq!(pool.last_accrued_ts, GENESIS_TS);
    assert_eq!(pool.created_at, GENESIS_TS);
    assert_pool_invariant(&after, &p.pool);
}

// Vault і мінти траншів належать пулу: лише програма під підписом PDA
// карбує частки і випускає базовий токен.
#[test]
fn create_pool_makes_pool_the_authority_of_vault_and_tranche_mints() {
    let (session, s, p) = pool_session();
    let after = session.snapshot();

    let vault = TokenAccount::unpack(&account_of(&after, &p.vault).data).unwrap();
    assert_eq!(vault.mint, s.mint);
    assert_eq!(vault.owner, p.pool);
    assert_eq!(token_amount(&after, &p.vault), 0);

    for key in [p.senior_mint, p.junior_mint] {
        let mint = Mint::unpack(&account_of(&after, &key).data).unwrap();
        assert_eq!(mint.decimals, DEMO_MINT_DECIMALS);
        assert_eq!(mint.mint_authority, COption::Some(p.pool));
        assert_eq!(mint.freeze_authority, COption::None);
        assert_eq!(mint_supply(&after, &key), 0);
    }
}

#[test]
fn create_pool_twice_with_same_id_is_refused_and_other_id_passes() {
    let (mut session, s, p) = pool_session();
    let again = session.run(&create_pool(&s, &p, s.authority), &[]);
    assert!(again.raw_result.is_err());
    assert_eq!(
        pool_state(&session.snapshot(), &p.pool).created_at,
        GENESIS_TS
    );

    let second = pool_setup(p.id + 1, p.params);
    session.run(&create_pool(&s, &second, s.authority), &[Check::success()]);
    let after = session.snapshot();
    assert_eq!(pool_state(&after, &second.pool).id, p.id + 1);
    assert_ne!(second.vault, p.vault);
    assert_pool_invariant(&after, &second.pool);
}

#[test]
fn create_pool_by_foreign_signer_is_refused() {
    let (mut session, s) = configured_session();
    session.set(USER_A, signer_account());
    let (id, params) = demo_params();
    let p = pool_setup(id, params);
    let result = session.run(&create_pool(&s, &p, USER_A), &[]);
    assert!(result.raw_result.is_err());
    assert!(session.logs().iter().any(|l| l.contains("Unauthorized")));
    assert!(session.get(&p.pool).data.is_empty());
}

// Чужий базовий мінт: `has_one = mint` на Config відкидає його до будь-якого init.
#[test]
fn create_pool_with_foreign_mint_is_refused() {
    let (mut session, mut s) = configured_session();
    let (id, params) = demo_params();
    let p = pool_setup(id, params);
    s.mint = Pubkey::new_from_array([99; 32]);
    let result = session.run(&create_pool(&s, &p, s.authority), &[]);
    assert!(result.raw_result.is_err());
}

fn refused_with(params: PoolParams) {
    let (mut session, s) = configured_session();
    let p = pool_setup(7, params);
    let result = session.run(&create_pool(&s, &p, s.authority), &[]);
    assert!(result.raw_result.is_err(), "{params:?} мало бути відхилено");
    assert!(
        session
            .logs()
            .iter()
            .any(|l| l.contains("ParameterOutOfRange")),
        "{params:?}: не ParameterOutOfRange"
    );
}

fn accepted_with(params: PoolParams) {
    let (mut session, s) = configured_session();
    let p = pool_setup(7, params);
    session.run(&create_pool(&s, &p, s.authority), &[Check::success()]);
}

#[test]
fn create_pool_rejects_params_outside_bounds() {
    let (_, base) = demo_params();
    refused_with(PoolParams {
        yield_rate_bps: MAX_BPS + 1,
        ..base
    });
    refused_with(PoolParams {
        senior_rate_bps: MAX_BPS + 1,
        ..base
    });
    refused_with(PoolParams {
        perf_fee_bps: MAX_BPS + 1,
        ..base
    });
    // Мінімум junior у 100 % заблокував би кожен senior-депозит.
    refused_with(PoolParams {
        min_junior_bps: MAX_BPS,
        ..base
    });
    refused_with(PoolParams {
        time_scale: 0,
        ..base
    });
    refused_with(PoolParams {
        time_scale: MAX_TIME_SCALE + 1,
        ..base
    });
}

// Краї дозволеного: 100 % ставок, 0 % комісії, звичайний час і максимальний масштаб.
#[test]
fn create_pool_accepts_boundary_params() {
    let (_, base) = demo_params();
    accepted_with(PoolParams {
        yield_rate_bps: MAX_BPS,
        senior_rate_bps: MAX_BPS,
        perf_fee_bps: MAX_BPS,
        min_junior_bps: MAX_BPS - 1,
        time_scale: MAX_TIME_SCALE,
    });
    accepted_with(PoolParams {
        yield_rate_bps: 0,
        senior_rate_bps: 0,
        perf_fee_bps: 0,
        min_junior_bps: 0,
        time_scale: 1,
    });
    // Ставка senior вище доходу пулу — законно: waterfall дає senior лише те,
    // що покриває дохід.
    accepted_with(PoolParams {
        senior_rate_bps: base.yield_rate_bps + 100,
        ..base
    });
}
