// Один модуль на кілька тестових бінарників: те, чого не вживає котрийсь із них,
// інакше падає під `-D warnings` як dead_code.
#![allow(dead_code)]

pub mod pda;

use std::collections::HashMap;

use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use mollusk_svm::program::loader_keys::LOADER_V3;
use mollusk_svm::result::{Check, InstructionResult};
use mollusk_svm::Mollusk;
use mollusk_svm_programs_token::{associated_token, token};
use solana_account::Account;
use solana_instruction::Instruction;
use solana_program_option::COption;
use solana_program_pack::Pack;
use solana_pubkey::Pubkey;
use solana_svm_log_collector::LogCollector;
use spl_token_interface::state::{Account as TokenAccount, AccountState, Mint};
use washapp::constants::DEMO_MINT_DECIMALS;
use washapp::state::{Config, Pool};

pub const TOKEN_PROGRAM: Pubkey = token::ID;
pub const ATA_PROGRAM: Pubkey = associated_token::ID;

const ELF: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../target/deploy/washapp.so"
);

// Ключі в тестах фіксовані, не `new_unique()`: CU гуляє від bump-пошуку PDA, і
// CU-гейт на випадкових ключах то проходить, то ні.
pub const OPERATOR: Pubkey = Pubkey::new_from_array([7; 32]);
pub const USER_A: Pubkey = Pubkey::new_from_array([11; 32]);
pub const USER_B: Pubkey = Pubkey::new_from_array([13; 32]);

pub struct Harness {
    pub mollusk: Mollusk,
}

impl Default for Harness {
    fn default() -> Self {
        Self::new()
    }
}

impl Harness {
    // ELF береться явно з `target/deploy`, а не через пошук mollusk по cwd:
    // `cargo test` запускається з теки пакета, де `target/` немає.
    pub fn new() -> Self {
        let elf = std::fs::read(ELF).unwrap_or_else(|e| panic!("{ELF}: {e} — спершу build-sbf"));
        let mut mollusk = Mollusk::default();
        mollusk.add_program_with_loader_and_elf(&washapp::ID, &LOADER_V3, &elf);
        token::add_program(&mut mollusk);
        associated_token::add_program(&mut mollusk);
        Self { mollusk }
    }

    // `warp_to_slot` перебудовує Clock з нуля і обнуляє unix_timestamp — тести
    // модельного часу з таким годинником зеленіли б на «зараз = 0».
    pub fn warp(&mut self, slot: u64, unix_timestamp: i64) {
        self.mollusk.warp_to_slot(slot);
        self.mollusk.sysvars.clock.unix_timestamp = unix_timestamp;
    }

    // Ліміт LogCollector (10 КБ) рахується за все життя збирача, а не за прогін:
    // зі спільним збирачем події зникають десь із 15-го виклику.
    pub fn process(
        &mut self,
        instruction: &Instruction,
        accounts: &[(Pubkey, Account)],
        checks: &[Check],
    ) -> InstructionResult {
        self.mollusk.logger = Some(LogCollector::new_ref());
        self.mollusk
            .process_and_validate_instruction(instruction, accounts, checks)
    }

    pub fn logs(&self) -> Vec<String> {
        self.mollusk
            .logger
            .as_ref()
            .map(|l| l.borrow().get_recorded_content().to_vec())
            .unwrap_or_default()
    }
}

pub fn signer_account() -> Account {
    Account::new(10_000_000_000, 0, &Pubkey::default())
}

// Виконувані акаунти, які потрібні будь-якій інструкції з CPI у SPL Token.
pub fn program_accounts() -> Vec<(Pubkey, Account)> {
    vec![
        mollusk_svm::program::keyed_account_for_system_program(),
        token::keyed_account(),
        associated_token::keyed_account(),
    ]
}

pub fn mint_account(authority: Pubkey, supply: u64) -> Account {
    token::create_account_for_mint(Mint {
        mint_authority: COption::Some(authority),
        supply,
        decimals: DEMO_MINT_DECIMALS,
        is_initialized: true,
        freeze_authority: COption::None,
    })
}

pub fn token_account(mint: Pubkey, owner: Pubkey, amount: u64) -> Account {
    token::create_account_for_token_account(TokenAccount {
        mint,
        owner,
        amount,
        delegate: COption::None,
        state: AccountState::Initialized,
        is_native: COption::None,
        delegated_amount: 0,
        close_authority: COption::None,
    })
}

pub fn ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    anchor_spl::associated_token::get_associated_token_address(owner, mint)
}

pub fn ata_account(owner: Pubkey, mint: Pubkey, amount: u64) -> (Pubkey, Account) {
    (ata(&owner, &mint), token_account(mint, owner, amount))
}

// Читачі стану після інструкції: панікують із зрозумілим текстом, якщо акаунта
// немає або він не того типу — інакше тест падав би на `unwrap` без адреси.
pub fn account_of<'a>(accounts: &'a [(Pubkey, Account)], key: &Pubkey) -> &'a Account {
    accounts
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, a)| a)
        .unwrap_or_else(|| panic!("акаунта {key} немає серед результатів"))
}

pub fn pool_state(accounts: &[(Pubkey, Account)], key: &Pubkey) -> Pool {
    Pool::try_deserialize(&mut account_of(accounts, key).data.as_slice())
        .unwrap_or_else(|e| panic!("{key} не Pool: {e}"))
}

pub fn config_state(accounts: &[(Pubkey, Account)], key: &Pubkey) -> Config {
    Config::try_deserialize(&mut account_of(accounts, key).data.as_slice())
        .unwrap_or_else(|e| panic!("{key} не Config: {e}"))
}

pub fn token_amount(accounts: &[(Pubkey, Account)], key: &Pubkey) -> u64 {
    TokenAccount::unpack(&account_of(accounts, key).data)
        .unwrap_or_else(|e| panic!("{key} не токен-акаунт: {e}"))
        .amount
}

pub fn mint_supply(accounts: &[(Pubkey, Account)], key: &Pubkey) -> u64 {
    Mint::unpack(&account_of(accounts, key).data)
        .unwrap_or_else(|e| panic!("{key} не мінт: {e}"))
        .supply
}

// SC-002 у SVM: облік пулу і баланс vault — одне число з трьох джерел.
pub fn assert_pool_invariant(accounts: &[(Pubkey, Account)], pool_key: &Pubkey) {
    let pool = pool_state(accounts, pool_key);
    let vault = token_amount(accounts, &pool.vault);
    assert_eq!(
        pool.assets,
        pool.senior_assets + pool.junior_assets,
        "pool {pool_key}: assets ≠ senior + junior"
    );
    assert_eq!(pool.assets, vault, "pool {pool_key}: assets ≠ vault.amount");
}

// Стан між інструкціями: кожен `run` бере з мапи лише акаунти інструкції
// (відсутні — порожні) і повертає результат назад. Так послідовність
// «init → deposit → accrue → redeem» пишеться як список викликів.
pub struct Session {
    pub harness: Harness,
    pub accounts: HashMap<Pubkey, Account>,
}

impl Session {
    pub fn new(seed: Vec<(Pubkey, Account)>) -> Self {
        let mut accounts: HashMap<_, _> = program_accounts().into_iter().collect();
        accounts.extend(seed);
        Self {
            harness: Harness::new(),
            accounts,
        }
    }

    pub fn set(&mut self, key: Pubkey, account: Account) {
        self.accounts.insert(key, account);
    }

    pub fn get(&self, key: &Pubkey) -> Account {
        self.accounts.get(key).cloned().unwrap_or_default()
    }

    pub fn snapshot(&self) -> Vec<(Pubkey, Account)> {
        self.accounts.iter().map(|(k, a)| (*k, a.clone())).collect()
    }

    pub fn run(&mut self, instruction: &Instruction, checks: &[Check]) -> InstructionResult {
        let inputs: Vec<_> = instruction
            .accounts
            .iter()
            .map(|m| (m.pubkey, self.get(&m.pubkey)))
            .collect();
        let result = self.harness.process(instruction, &inputs, checks);
        if result.raw_result.is_ok() {
            for (key, account) in &result.resulting_accounts {
                self.accounts.insert(*key, account.clone());
            }
        }
        result
    }

    pub fn logs(&self) -> Vec<String> {
        self.harness.logs()
    }
}

pub struct ConfigSetup {
    pub config: Pubkey,
    pub bump: u8,
    pub authority: Pubkey,
    pub faucet_cap: u64,
}

pub fn config_setup() -> ConfigSetup {
    let (config, bump) = Pubkey::find_program_address(&[Config::SEED], &washapp::ID);
    ConfigSetup {
        config,
        bump,
        authority: OPERATOR,
        faucet_cap: 1_000_000_000,
    }
}

pub fn init_config(s: &ConfigSetup) -> Instruction {
    Instruction {
        program_id: washapp::ID,
        accounts: washapp::accounts::InitConfig {
            config: s.config,
            authority: s.authority,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: washapp::instruction::InitConfig {
            faucet_cap: s.faucet_cap,
        }
        .data(),
    }
}

pub fn init_config_accounts(s: &ConfigSetup) -> Vec<(Pubkey, Account)> {
    vec![
        (s.config, Account::default()),
        (s.authority, signer_account()),
        mollusk_svm::program::keyed_account_for_system_program(),
    ]
}
