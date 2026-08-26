mod common;

use anchor_lang::{AccountDeserialize, Space};
use common::{
    account_of, config_setup, config_state, configured_session, init_config, init_config_accounts,
    Harness,
};
use mollusk_svm::result::Check;
use solana_program_option::COption;
use solana_program_pack::Pack;
use spl_token_interface::state::{Account as TokenAccount, Mint};
use washapp::constants::DEMO_MINT_DECIMALS;
use washapp::state::Config;

// anchor-lang і mollusk тягнуть solana-крейти різних поколінь; на цьому локу
// обидва реекспортують один `solana-address`, тож `Pubkey` — один тип без моста.
// Якщо лок поїде, цей тест перестане компілюватися — і саме це його робота.
#[test]
fn pubkey_types_are_one() {
    let id: solana_pubkey::Pubkey = washapp::ID;
    let via_anchor: anchor_lang::prelude::Pubkey = id;
    assert_eq!(id, via_anchor);
}

#[test]
fn init_config_stores_authority_cap_and_bump() {
    let s = config_setup();
    let mut h = Harness::new();
    let result = h.process(
        &init_config(&s),
        &init_config_accounts(&s),
        &[Check::success()],
    );

    let stored = result.get_account(&s.config).unwrap();
    assert_eq!(stored.owner, washapp::ID);
    assert_eq!(stored.data.len(), 8 + Config::INIT_SPACE);
    let config = Config::try_deserialize(&mut stored.data.as_slice()).unwrap();
    assert_eq!(config.authority, s.authority);
    assert_eq!(config.mint, s.mint);
    assert_eq!(config.treasury, s.treasury);
    assert_eq!(config.faucet_cap, s.faucet_cap);
    assert_eq!(config.bump, s.bump);
}

// Мінт карбує лише програма; treasury належить оператору, щоб комісії можна
// було забрати звичайним SPL-переказом.
#[test]
fn init_config_creates_demo_mint_and_operator_treasury() {
    let s = config_setup();
    let mut h = Harness::new();
    let result = h.process(
        &init_config(&s),
        &init_config_accounts(&s),
        &[Check::success()],
    );
    let after = result.resulting_accounts;

    let mint = Mint::unpack(&account_of(&after, &s.mint).data).unwrap();
    assert_eq!(mint.decimals, DEMO_MINT_DECIMALS);
    assert_eq!(mint.supply, 0);
    assert_eq!(mint.mint_authority, COption::Some(s.config));
    assert_eq!(mint.freeze_authority, COption::None);

    let treasury = TokenAccount::unpack(&account_of(&after, &s.treasury).data).unwrap();
    assert_eq!(treasury.mint, s.mint);
    assert_eq!(treasury.owner, s.authority);
    assert_eq!(treasury.amount, 0);
}

#[test]
fn init_config_twice_is_refused() {
    let (mut session, s) = configured_session();
    let again = session.run(&init_config(&s), &[]);
    assert!(again.raw_result.is_err());
    // Стан першого init лишається недоторканим.
    assert_eq!(
        config_state(&session.snapshot(), &s.config).authority,
        s.authority
    );
}

#[test]
fn init_config_rejects_zero_faucet_cap() {
    let mut s = config_setup();
    s.faucet_cap = 0;
    let mut h = Harness::new();
    let result = h.process(&init_config(&s), &init_config_accounts(&s), &[]);
    assert!(result.raw_result.is_err());
    assert!(h.logs().iter().any(|l| l.contains("ParameterOutOfRange")));
}
