// Один модуль на кілька тестових бінарників: те, чого не вживає котрийсь із них,
// інакше падає під `-D warnings` як dead_code.
#![allow(dead_code)]

use anchor_lang::{InstructionData, ToAccountMetas};
use mollusk_svm::program::loader_keys::LOADER_V3;
use mollusk_svm::result::{Check, InstructionResult};
use mollusk_svm::Mollusk;
use solana_account::Account;
use solana_instruction::Instruction;
use solana_pubkey::Pubkey;
use solana_svm_log_collector::LogCollector;
use washapp::state::Config;

pub const TOKEN_PROGRAM: Pubkey =
    Pubkey::from_str_const("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

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
