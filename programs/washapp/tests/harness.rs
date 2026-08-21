// Харнес перевіряється до першої інструкції з CPI: якщо SPL Token або ATA не
// завантажені чи білдери акаунтів кладуть не ті байти, кожен тест US1 падав би
// повідомленням про чужу програму, а не про свій код.
mod common;

use anchor_lang::AccountSerialize;
use common::*;
use mollusk_svm::result::Check;
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;
use spl_token_interface::instruction::transfer;
use washapp::state::Pool;

const MINT: Pubkey = Pubkey::new_from_array([21; 32]);
const VAULT: Pubkey = Pubkey::new_from_array([22; 32]);
const POOL: Pubkey = Pubkey::new_from_array([23; 32]);

#[test]
fn builders_round_trip_through_spl_layouts() {
    let accounts = vec![
        (MINT, mint_account(OPERATOR, 5_000)),
        (VAULT, token_account(MINT, POOL, 1_234)),
    ];
    assert_eq!(mint_supply(&accounts, &MINT), 5_000);
    assert_eq!(token_amount(&accounts, &VAULT), 1_234);
    assert_eq!(account_of(&accounts, &MINT).owner, TOKEN_PROGRAM);

    let (addr, account) = ata_account(USER_A, MINT, 7);
    let expected = Pubkey::find_program_address(
        &[USER_A.as_ref(), TOKEN_PROGRAM.as_ref(), MINT.as_ref()],
        &ATA_PROGRAM,
    )
    .0;
    assert_eq!(addr, expected);
    assert_eq!(token_amount(&[(addr, account)], &addr), 7);
}

#[test]
fn session_runs_spl_transfer_and_keeps_state_between_calls() {
    let (from, from_account) = ata_account(USER_A, MINT, 1_000);
    let (to, to_account) = ata_account(USER_B, MINT, 0);
    let mut s = Session::new(vec![
        (MINT, mint_account(OPERATOR, 1_000)),
        (from, from_account),
        (to, to_account),
        (USER_A, signer_account()),
    ]);
    let ix = |amount| transfer(&TOKEN_PROGRAM, &from, &to, &USER_A, &[], amount).unwrap();

    s.run(&ix(400), &[Check::success()]);
    s.run(&ix(100), &[Check::success()]);
    let after = s.snapshot();
    assert_eq!(token_amount(&after, &from), 500);
    assert_eq!(token_amount(&after, &to), 500);

    // Відмова не зсуває стан сесії: наступний виклик бачить попередній баланс.
    let failed = s.run(&ix(600), &[]);
    assert!(failed.raw_result.is_err());
    assert_eq!(token_amount(&s.snapshot(), &from), 500);
}

#[test]
fn session_creates_associated_token_account() {
    let mut s = Session::new(vec![
        (MINT, mint_account(OPERATOR, 0)),
        (USER_A, signer_account()),
    ]);
    let addr = ata(&USER_A, &MINT);
    let create = Instruction {
        program_id: ATA_PROGRAM,
        accounts: vec![
            AccountMeta::new(USER_A, true),
            AccountMeta::new(addr, false),
            AccountMeta::new_readonly(USER_A, false),
            AccountMeta::new_readonly(MINT, false),
            AccountMeta::new_readonly(anchor_lang::system_program::ID, false),
            AccountMeta::new_readonly(TOKEN_PROGRAM, false),
        ],
        // 1 — CreateIdempotent: те, що робитиме `faucet` через `init_if_needed`.
        data: vec![1],
    };
    s.run(&create, &[Check::success()]);
    let after = s.snapshot();
    assert_eq!(token_amount(&after, &addr), 0);
    assert_eq!(account_of(&after, &addr).owner, TOKEN_PROGRAM);
}

#[test]
fn session_refuses_second_init_config() {
    let c = config_setup();
    let mut s = Session::new(vec![(c.authority, signer_account())]);
    s.run(&init_config(&c), &[Check::success()]);
    assert_eq!(
        config_state(&s.snapshot(), &c.config).faucet_cap,
        c.faucet_cap
    );

    let again = s.run(&init_config(&c), &[]);
    assert!(again.raw_result.is_err());
}

fn pool_account(assets: u64, senior: u64, junior: u64) -> Account {
    let pool = Pool {
        id: 0,
        operator: OPERATOR,
        mint: MINT,
        vault: VAULT,
        senior_mint: Pubkey::default(),
        junior_mint: Pubkey::default(),
        yield_rate_bps: 800,
        senior_rate_bps: 500,
        min_junior_bps: 2_000,
        perf_fee_bps: 1_000,
        time_scale: 43_200,
        assets,
        senior_assets: senior,
        junior_assets: junior,
        model_time: 0,
        last_accrued_ts: 0,
        loss_count: 0,
        created_at: 0,
        bump: 255,
    };
    let mut data = Vec::new();
    pool.try_serialize(&mut data).unwrap();
    Account {
        lamports: 1,
        data,
        owner: washapp::ID,
        executable: false,
        rent_epoch: 0,
    }
}

#[test]
fn pool_invariant_passes_when_three_numbers_agree() {
    let accounts = vec![
        (POOL, pool_account(100, 75, 25)),
        (VAULT, token_account(MINT, POOL, 100)),
    ];
    assert_pool_invariant(&accounts, &POOL);
    assert_eq!(pool_state(&accounts, &POOL).vault, VAULT);
}

#[test]
#[should_panic(expected = "assets ≠ vault.amount")]
fn pool_invariant_catches_vault_drift() {
    let accounts = vec![
        (POOL, pool_account(100, 75, 25)),
        (VAULT, token_account(MINT, POOL, 99)),
    ];
    assert_pool_invariant(&accounts, &POOL);
}

#[test]
#[should_panic(expected = "assets ≠ senior + junior")]
fn pool_invariant_catches_tranche_drift() {
    let accounts = vec![
        (POOL, pool_account(100, 75, 24)),
        (VAULT, token_account(MINT, POOL, 100)),
    ];
    assert_pool_invariant(&accounts, &POOL);
}
