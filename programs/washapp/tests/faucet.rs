mod common;

use common::{
    ata, configured_session, faucet, mint_supply, signer_account, token_amount, USER_A, USER_B,
};
use mollusk_svm::result::Check;

#[test]
fn faucet_creates_ata_and_mints_up_to_cap() {
    let (mut session, s) = configured_session();
    session.set(USER_A, signer_account());
    let user_ata = ata(&USER_A, &s.mint);

    session.run(&faucet(&s, USER_A, 250), &[Check::success()]);
    let after = session.snapshot();
    assert_eq!(token_amount(&after, &user_ata), 250);
    assert_eq!(mint_supply(&after, &s.mint), 250);

    // Другий виклик — в уже створений ATA; рівно cap дозволено.
    session.run(&faucet(&s, USER_A, s.faucet_cap), &[Check::success()]);
    let after = session.snapshot();
    assert_eq!(token_amount(&after, &user_ata), 250 + s.faucet_cap);
    assert_eq!(mint_supply(&after, &s.mint), 250 + s.faucet_cap);
}

#[test]
fn faucet_above_cap_is_refused() {
    let (mut session, s) = configured_session();
    session.set(USER_B, signer_account());
    let result = session.run(&faucet(&s, USER_B, s.faucet_cap + 1), &[]);
    assert!(result.raw_result.is_err());
    assert!(session
        .logs()
        .iter()
        .any(|l| l.contains("FaucetCapExceeded")));
    assert_eq!(mint_supply(&session.snapshot(), &s.mint), 0);
}

#[test]
fn faucet_zero_is_refused() {
    let (mut session, s) = configured_session();
    session.set(USER_B, signer_account());
    let result = session.run(&faucet(&s, USER_B, 0), &[]);
    assert!(result.raw_result.is_err());
    assert!(session.logs().iter().any(|l| l.contains("ZeroAmount")));
}

// Чужий мінт у інструкції — `has_one = mint` на Config його відкидає ще до CPI.
#[test]
fn faucet_with_foreign_mint_is_refused() {
    let (mut session, mut s) = configured_session();
    session.set(USER_A, signer_account());
    s.mint = solana_pubkey::Pubkey::new_from_array([99; 32]);
    let result = session.run(&faucet(&s, USER_A, 1), &[]);
    assert!(result.raw_result.is_err());
}
