// Деривація всіх PDA програми з одного місця: тести US1–US4 беруть адреси
// звідси, а `tests/pda.rs` пише з них `fixtures/pda.json` для `pda.ts`.
use solana_pubkey::Pubkey;
use washapp::constants::{
    CONFIG_SEED, CONTRACT_SEED, JUNIOR_MINT_SEED, LOSS_SEED, MINT_SEED, POOL_SEED, PROTECTION_SEED,
    PVAULT_SEED, SELLER_SEED, SENIOR_MINT_SEED, TREASURY_SEED, VAULT_SEED,
};

fn find(seeds: &[&[u8]]) -> (Pubkey, u8) {
    Pubkey::find_program_address(seeds, &washapp::ID)
}

pub fn config() -> (Pubkey, u8) {
    find(&[CONFIG_SEED])
}

pub fn mint() -> (Pubkey, u8) {
    find(&[MINT_SEED])
}

pub fn treasury() -> (Pubkey, u8) {
    find(&[TREASURY_SEED])
}

pub fn pool(id: u16) -> (Pubkey, u8) {
    find(&[POOL_SEED, &id.to_le_bytes()])
}

// Vault, мінти траншів і pvault ключуються адресою пулу, не його id:
// їхні seeds ніколи не потребують розбору id з байтів.
pub fn vault(pool: &Pubkey) -> (Pubkey, u8) {
    find(&[VAULT_SEED, pool.as_ref()])
}

pub fn senior_mint(pool: &Pubkey) -> (Pubkey, u8) {
    find(&[SENIOR_MINT_SEED, pool.as_ref()])
}

pub fn junior_mint(pool: &Pubkey) -> (Pubkey, u8) {
    find(&[JUNIOR_MINT_SEED, pool.as_ref()])
}

pub fn loss_event(pool: &Pubkey, index: u32) -> (Pubkey, u8) {
    find(&[LOSS_SEED, pool.as_ref(), &index.to_le_bytes()])
}

pub fn protection(pool: &Pubkey) -> (Pubkey, u8) {
    find(&[PROTECTION_SEED, pool.as_ref()])
}

pub fn pvault(pool: &Pubkey) -> (Pubkey, u8) {
    find(&[PVAULT_SEED, pool.as_ref()])
}

pub fn seller(pool: &Pubkey, owner: &Pubkey) -> (Pubkey, u8) {
    find(&[SELLER_SEED, pool.as_ref(), owner.as_ref()])
}

pub fn contract(pool: &Pubkey, buyer: &Pubkey, nonce: u64) -> (Pubkey, u8) {
    find(&[
        CONTRACT_SEED,
        pool.as_ref(),
        buyer.as_ref(),
        &nonce.to_le_bytes(),
    ])
}
