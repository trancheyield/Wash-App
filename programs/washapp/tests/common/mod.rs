// Один модуль на кілька тестових бінарників: те, чого не вживає котрийсь із них,
// інакше падає під `-D warnings` як dead_code.
#![allow(dead_code)]

pub mod pda;

use std::collections::HashMap;

use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas};
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
use washapp::instructions::PoolParams;
use washapp::math::{PoolBalances, Tranche};
use washapp::state::{Config, LossEvent, Pool, ProtectionContract, ProtectionPool, SellerPosition};

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

pub fn loss_event_state(accounts: &[(Pubkey, Account)], key: &Pubkey) -> LossEvent {
    LossEvent::try_deserialize(&mut &account_of(accounts, key).data[..])
        .unwrap_or_else(|e| panic!("{key} не LossEvent: {e}"))
}

pub fn protection_state(accounts: &[(Pubkey, Account)], key: &Pubkey) -> ProtectionPool {
    ProtectionPool::try_deserialize(&mut &account_of(accounts, key).data[..])
        .unwrap_or_else(|e| panic!("{key} не ProtectionPool: {e}"))
}

pub fn contract_state(accounts: &[(Pubkey, Account)], key: &Pubkey) -> ProtectionContract {
    ProtectionContract::try_deserialize(&mut &account_of(accounts, key).data[..])
        .unwrap_or_else(|e| panic!("{key} не ProtectionContract: {e}"))
}

pub fn seller_state(accounts: &[(Pubkey, Account)], key: &Pubkey) -> SellerPosition {
    SellerPosition::try_deserialize(&mut &account_of(accounts, key).data[..])
        .unwrap_or_else(|e| panic!("{key} не SellerPosition: {e}"))
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

// Те саме для захисного пулу: облік забезпечення — це баланс pvault, а
// зарезервоване ніколи не перевищує забезпечення.
pub fn assert_protection_invariant(accounts: &[(Pubkey, Account)], key: &Pubkey) {
    let protection = protection_state(accounts, key);
    let pvault = token_amount(accounts, &protection.pvault);
    assert_eq!(
        protection.collateral, pvault,
        "protection {key}: collateral ≠ pvault.amount"
    );
    assert!(
        protection.reserved <= protection.collateral,
        "protection {key}: reserved > collateral"
    );
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
    pub mint: Pubkey,
    pub treasury: Pubkey,
    pub authority: Pubkey,
    pub faucet_cap: u64,
}

pub fn config_setup() -> ConfigSetup {
    let (config, bump) = pda::config();
    ConfigSetup {
        config,
        bump,
        mint: pda::mint().0,
        treasury: pda::treasury().0,
        authority: OPERATOR,
        // 1 000 000 токенів: сценарії US1 кладуть 75 000 + 25 000 одним faucet.
        faucet_cap: 1_000_000_000_000,
    }
}

pub fn init_config(s: &ConfigSetup) -> Instruction {
    Instruction {
        program_id: washapp::ID,
        accounts: washapp::accounts::InitConfig {
            config: s.config,
            mint: s.mint,
            treasury: s.treasury,
            authority: s.authority,
            token_program: TOKEN_PROGRAM,
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
    let mut accounts = vec![
        (s.config, Account::default()),
        (s.mint, Account::default()),
        (s.treasury, Account::default()),
        (s.authority, signer_account()),
    ];
    accounts.extend(program_accounts());
    accounts
}

pub fn faucet(s: &ConfigSetup, owner: Pubkey, amount: u64) -> Instruction {
    Instruction {
        program_id: washapp::ID,
        accounts: washapp::accounts::Faucet {
            config: s.config,
            mint: s.mint,
            owner_ata: ata(&owner, &s.mint),
            owner,
            token_program: TOKEN_PROGRAM,
            associated_token_program: ATA_PROGRAM,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: washapp::instruction::Faucet { amount }.data(),
    }
}

// Сесія з готовим `Config`, мінтом і treasury — стартова точка тестів US1+.
pub fn configured_session() -> (Session, ConfigSetup) {
    let s = config_setup();
    let mut session = Session::new(init_config_accounts(&s));
    session.run(&init_config(&s), &[Check::success()]);
    (session, s)
}

pub struct PoolSetup {
    pub id: u16,
    pub pool: Pubkey,
    pub bump: u8,
    pub vault: Pubkey,
    pub senior_mint: Pubkey,
    pub junior_mint: Pubkey,
    pub params: PoolParams,
}

pub fn pool_setup(id: u16, params: PoolParams) -> PoolSetup {
    let (pool, bump) = pda::pool(id);
    PoolSetup {
        id,
        pool,
        bump,
        vault: pda::vault(&pool).0,
        senior_mint: pda::senior_mint(&pool).0,
        junior_mint: pda::junior_mint(&pool).0,
        params,
    }
}

// Параметри демо-пулу — з `fixtures/params.json`, того самого, що читають бриф M0
// і `tools/demo`: тести звіряються з тими ж числами, що показує екран.
pub fn demo_params() -> (u16, PoolParams) {
    let raw = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/params.json"
    ))
    .expect("fixtures/params.json");
    let v: serde_json::Value = serde_json::from_str(&raw).expect("params.json — не JSON");
    let field = |name: &str| -> u64 {
        v[name]
            .as_u64()
            .unwrap_or_else(|| panic!("params.json: немає числа `{name}`"))
    };
    let params = PoolParams {
        yield_rate_bps: field("yield_rate_bps") as u16,
        senior_rate_bps: field("senior_rate_bps") as u16,
        min_junior_bps: field("min_junior_bps") as u16,
        perf_fee_bps: field("perf_fee_bps") as u16,
        time_scale: field("time_scale") as u32,
    };
    (field("pool_id") as u16, params)
}

pub fn create_pool(s: &ConfigSetup, p: &PoolSetup, operator: Pubkey) -> Instruction {
    Instruction {
        program_id: washapp::ID,
        accounts: washapp::accounts::CreatePool {
            config: s.config,
            mint: s.mint,
            pool: p.pool,
            vault: p.vault,
            senior_mint: p.senior_mint,
            junior_mint: p.junior_mint,
            operator,
            token_program: TOKEN_PROGRAM,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: washapp::instruction::CreatePool {
            id: p.id,
            params: p.params,
        }
        .data(),
    }
}

// Сесія з `Config` і демо-пулом із `fixtures/params.json` — старт для
// deposit/accrue/redeem. Годинник — ненульовий, щоб `created_at` не був 0.
pub const GENESIS_TS: i64 = 1_700_000_000;

pub fn pool_session() -> (Session, ConfigSetup, PoolSetup) {
    let (mut session, s) = configured_session();
    let (id, params) = demo_params();
    let p = pool_setup(id, params);
    session.harness.warp(1, GENESIS_TS);
    session.run(&create_pool(&s, &p, s.authority), &[Check::success()]);
    (session, s, p)
}

pub fn accrue(s: &ConfigSetup, p: &PoolSetup) -> Instruction {
    Instruction {
        program_id: washapp::ID,
        accounts: washapp::accounts::Accrue {
            config: s.config,
            mint: s.mint,
            treasury: s.treasury,
            pool: p.pool,
            vault: p.vault,
            senior_mint: p.senior_mint,
            junior_mint: p.junior_mint,
            token_program: TOKEN_PROGRAM,
        }
        .to_account_metas(None),
        data: washapp::instruction::Accrue {}.data(),
    }
}

// Пул із готовими балансами без `deposit` (T014): облік пулу, supply мінтів
// траншів і vault виставляються узгоджено — так, ніби кожен транш заповнив
// один вкладник 1:1. Демо-мінт отримує той самий supply, щоб `mint_to` далі
// не карбував «з повітря» понад облік.
pub fn seed_pool_balances(session: &mut Session, p: &PoolSetup, senior: u64, junior: u64) {
    seed_pool_state(
        session,
        p,
        &PoolBalances {
            assets: senior + junior,
            senior_assets: senior,
            junior_assets: junior,
            senior_supply: senior,
            junior_supply: junior,
        },
    );
}

// Повний контроль над обліком і supply — для станів після збитку (транш із
// частками без активів), які `deposit`/`accrue` самі не створять.
pub fn seed_pool_state(session: &mut Session, p: &PoolSetup, b: &PoolBalances) {
    let assets = b.assets;
    let mut pool_account = session.get(&p.pool);
    let mut pool = pool_state(&[(p.pool, pool_account.clone())], &p.pool);
    pool.assets = b.assets;
    pool.senior_assets = b.senior_assets;
    pool.junior_assets = b.junior_assets;
    let mut data = Vec::new();
    pool.try_serialize(&mut data).unwrap();
    pool_account.data = data;
    session.set(p.pool, pool_account);

    let (config, _) = pda::config();
    let mint = pda::mint().0;
    let demo_supply = mint_supply(&session.snapshot(), &mint);
    session.set(mint, mint_account(config, demo_supply + assets));
    session.set(p.vault, token_account(mint, p.pool, assets));
    session.set(p.senior_mint, mint_account(p.pool, b.senior_supply));
    session.set(p.junior_mint, mint_account(p.pool, b.junior_supply));
}

pub fn deposit(
    s: &ConfigSetup,
    p: &PoolSetup,
    owner: Pubkey,
    tranche: Tranche,
    amount: u64,
) -> Instruction {
    let tranche_mint = match tranche {
        Tranche::Senior => p.senior_mint,
        Tranche::Junior => p.junior_mint,
    };
    Instruction {
        program_id: washapp::ID,
        accounts: washapp::accounts::Deposit {
            config: s.config,
            mint: s.mint,
            treasury: s.treasury,
            pool: p.pool,
            vault: p.vault,
            senior_mint: p.senior_mint,
            junior_mint: p.junior_mint,
            owner_ata: ata(&owner, &s.mint),
            owner_tranche_ata: ata(&owner, &tranche_mint),
            owner,
            token_program: TOKEN_PROGRAM,
        }
        .to_account_metas(None),
        data: washapp::instruction::Deposit { tranche, amount }.data(),
    }
}

pub fn redeem(
    s: &ConfigSetup,
    p: &PoolSetup,
    owner: Pubkey,
    tranche: Tranche,
    shares: u64,
) -> Instruction {
    let tranche_mint = match tranche {
        Tranche::Senior => p.senior_mint,
        Tranche::Junior => p.junior_mint,
    };
    Instruction {
        program_id: washapp::ID,
        accounts: washapp::accounts::Redeem {
            config: s.config,
            mint: s.mint,
            treasury: s.treasury,
            pool: p.pool,
            vault: p.vault,
            senior_mint: p.senior_mint,
            junior_mint: p.junior_mint,
            owner_ata: ata(&owner, &s.mint),
            owner_tranche_ata: ata(&owner, &tranche_mint),
            owner,
            token_program: TOKEN_PROGRAM,
        }
        .to_account_metas(None),
        data: washapp::instruction::Redeem { tranche, shares }.data(),
    }
}

// `LossEvent` — під поточним `loss_count` пулу з сесії: тест не рахує індекс сам.
pub fn record_loss(
    session: &Session,
    s: &ConfigSetup,
    p: &PoolSetup,
    operator: Pubkey,
    loss_bps: u16,
) -> Instruction {
    let index = pool_state(&[(p.pool, session.get(&p.pool))], &p.pool).loss_count;
    Instruction {
        program_id: washapp::ID,
        accounts: washapp::accounts::RecordLoss {
            config: s.config,
            mint: s.mint,
            treasury: s.treasury,
            pool: p.pool,
            vault: p.vault,
            senior_mint: p.senior_mint,
            junior_mint: p.junior_mint,
            loss_event: pda::loss_event(&p.pool, index).0,
            operator,
            token_program: TOKEN_PROGRAM,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: washapp::instruction::RecordLoss { loss_bps }.data(),
    }
}

// Вкладник із SOL і базовим токеном з faucet — один рядок у тесті замість трьох.
// ATA траншів відкриваються тут же — програма їх не створює (кадр), у мережі
// це робить клієнт перед депозитом.
pub fn fund_user(session: &mut Session, s: &ConfigSetup, user: Pubkey, amount: u64) {
    session.set(user, signer_account());
    session.run(&faucet(s, user, amount), &[Check::success()]);
}

pub fn open_tranche_atas(session: &mut Session, p: &PoolSetup, user: Pubkey) {
    for mint in [p.senior_mint, p.junior_mint] {
        let (key, account) = ata_account(user, mint, 0);
        if session.get(&key).data.is_empty() {
            session.set(key, account);
        }
    }
}

pub struct ProtectionSetup {
    pub protection: Pubkey,
    pub bump: u8,
    pub pvault: Pubkey,
    pub premium_rate_bps: u16,
    pub trigger_bps: u16,
    pub premium_fee_bps: u16,
}

// Параметри захисту — з того самого `fixtures/params.json` (блок `protection`).
pub fn protection_setup(p: &PoolSetup) -> ProtectionSetup {
    let raw = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/params.json"
    ))
    .expect("fixtures/params.json");
    let v: serde_json::Value = serde_json::from_str(&raw).expect("params.json — не JSON");
    let field = |name: &str| -> u16 {
        v["protection"][name]
            .as_u64()
            .unwrap_or_else(|| panic!("params.json: немає числа `protection.{name}`"))
            as u16
    };
    let (protection, bump) = pda::protection(&p.pool);
    ProtectionSetup {
        protection,
        bump,
        pvault: pda::pvault(&p.pool).0,
        premium_rate_bps: field("premium_rate_bps"),
        trigger_bps: field("trigger_bps"),
        premium_fee_bps: field("premium_fee_bps"),
    }
}

pub fn init_protection(
    s: &ConfigSetup,
    p: &PoolSetup,
    pr: &ProtectionSetup,
    operator: Pubkey,
) -> Instruction {
    Instruction {
        program_id: washapp::ID,
        accounts: washapp::accounts::InitProtection {
            pool: p.pool,
            mint: s.mint,
            protection: pr.protection,
            pvault: pr.pvault,
            operator,
            token_program: TOKEN_PROGRAM,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: washapp::instruction::InitProtection {
            premium_rate_bps: pr.premium_rate_bps,
            trigger_bps: pr.trigger_bps,
            premium_fee_bps: pr.premium_fee_bps,
        }
        .data(),
    }
}

// Сесія з демо-пулом і його захисним пулом — старт для provide/withdraw/buy.
pub fn protection_session() -> (Session, ConfigSetup, PoolSetup, ProtectionSetup) {
    let (mut session, s, p) = pool_session();
    let pr = protection_setup(&p);
    session.run(
        &init_protection(&s, &p, &pr, s.authority),
        &[Check::success()],
    );
    (session, s, p, pr)
}

pub fn provide_protection(
    s: &ConfigSetup,
    p: &PoolSetup,
    pr: &ProtectionSetup,
    owner: Pubkey,
    amount: u64,
) -> Instruction {
    Instruction {
        program_id: washapp::ID,
        accounts: washapp::accounts::ProvideProtection {
            pool: p.pool,
            protection: pr.protection,
            pvault: pr.pvault,
            owner_ata: ata(&owner, &s.mint),
            position: pda::seller(&p.pool, &owner).0,
            owner,
            token_program: TOKEN_PROGRAM,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: washapp::instruction::ProvideProtection { amount }.data(),
    }
}

pub fn withdraw_protection(
    s: &ConfigSetup,
    p: &PoolSetup,
    pr: &ProtectionSetup,
    owner: Pubkey,
    shares: u64,
) -> Instruction {
    Instruction {
        program_id: washapp::ID,
        accounts: washapp::accounts::WithdrawProtection {
            pool: p.pool,
            protection: pr.protection,
            pvault: pr.pvault,
            owner_ata: ata(&owner, &s.mint),
            position: pda::seller(&p.pool, &owner).0,
            owner,
            token_program: TOKEN_PROGRAM,
        }
        .to_account_metas(None),
        data: washapp::instruction::WithdrawProtection { shares }.data(),
    }
}

pub fn buy_protection(
    s: &ConfigSetup,
    p: &PoolSetup,
    pr: &ProtectionSetup,
    buyer: Pubkey,
    notional: u64,
    term: u64,
    nonce: u64,
) -> Instruction {
    Instruction {
        program_id: washapp::ID,
        accounts: washapp::accounts::BuyProtection {
            config: s.config,
            mint: s.mint,
            treasury: s.treasury,
            pool: p.pool,
            vault: p.vault,
            senior_mint: p.senior_mint,
            junior_mint: p.junior_mint,
            protection: pr.protection,
            pvault: pr.pvault,
            buyer_ata: ata(&buyer, &s.mint),
            contract: pda::contract(&p.pool, &buyer, nonce).0,
            buyer,
            token_program: TOKEN_PROGRAM,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: washapp::instruction::BuyProtection {
            notional,
            term,
            nonce,
        }
        .data(),
    }
}

// Параметри захисту, відмінні від демо-фікстури: ставка премії 0 (безкоштовне
// покриття), інший поріг чи комісія. `init_protection` дає лише одні —
// переписати їх дешевше, ніж заводити другий пул.
pub fn seed_protection_rates(
    session: &mut Session,
    pr: &ProtectionSetup,
    premium_rate_bps: u16,
    trigger_bps: u16,
    premium_fee_bps: u16,
) {
    let mut account = session.get(&pr.protection);
    let mut protection = protection_state(&[(pr.protection, account.clone())], &pr.protection);
    protection.premium_rate_bps = premium_rate_bps;
    protection.trigger_bps = trigger_bps;
    protection.premium_fee_bps = premium_fee_bps;
    let mut data = Vec::new();
    protection.try_serialize(&mut data).unwrap();
    account.data = data;
    session.set(pr.protection, account);
}

// Стан захисного пулу, якого `provide` сам не створить: премія без нових
// часток (частка дорожчає), резерв під контракт до появи `buy_protection`,
// забезпечення, вичерпане виплатами. Демо-мінт отримує той самий приріст,
// щоб supply лишався узгодженим з балансами.
pub fn seed_protection_state(
    session: &mut Session,
    pr: &ProtectionSetup,
    collateral: u64,
    reserved: u64,
    share_supply: u64,
) {
    let mut account = session.get(&pr.protection);
    let mut protection = protection_state(&[(pr.protection, account.clone())], &pr.protection);
    let before = protection.collateral;
    protection.collateral = collateral;
    protection.reserved = reserved;
    protection.share_supply = share_supply;
    let mut data = Vec::new();
    protection.try_serialize(&mut data).unwrap();
    account.data = data;
    session.set(pr.protection, account);

    let (config, _) = pda::config();
    let mint = pda::mint().0;
    let demo_supply = mint_supply(&session.snapshot(), &mint) - before + collateral;
    session.set(mint, mint_account(config, demo_supply));
    session.set(pr.pvault, token_account(mint, pr.protection, collateral));
}
