mod common;

use anchor_lang::{AccountDeserialize, Space};
use common::{config_setup, init_config, init_config_accounts, Harness};
use mollusk_svm::result::Check;
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
    assert_eq!(config.faucet_cap, s.faucet_cap);
    assert_eq!(config.bump, s.bump);
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
