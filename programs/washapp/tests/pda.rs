mod common;

use std::collections::HashSet;
use std::path::PathBuf;

use common::pda;
use common::{USER_A, USER_B};
use serde_json::{json, Value};
use solana_pubkey::Pubkey;

// Фікстура живе в корені репо: `cargo test` запускається з теки пакета.
fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/pda.json")
}

fn entry((address, bump): (Pubkey, u8)) -> Value {
    json!({ "address": address.to_string(), "bump": bump })
}

// Краї кожного seed-аргументу: нуль, звичайне значення, максимум типу — щоб
// `pda.ts` не міг пройти на `Number` там, де потрібен повний `u64`.
const POOL_IDS: [u16; 3] = [0, 1, u16::MAX];
const LOSS_INDEXES: [(u16, u32); 3] = [(0, 0), (0, 7), (u16::MAX, u32::MAX)];
const NONCES: [(u16, u64); 3] = [(0, 0), (0, 1), (1, u64::MAX)];

fn fixture() -> Value {
    let pools: Vec<Value> = POOL_IDS
        .iter()
        .map(|&id| {
            let (pool, bump) = pda::pool(id);
            json!({
                "id": id,
                "pool": entry((pool, bump)),
                "vault": entry(pda::vault(&pool)),
                "seniorMint": entry(pda::senior_mint(&pool)),
                "juniorMint": entry(pda::junior_mint(&pool)),
                "protection": entry(pda::protection(&pool)),
                "pvault": entry(pda::pvault(&pool)),
            })
        })
        .collect();
    let loss_events: Vec<Value> = LOSS_INDEXES
        .iter()
        .map(|&(id, index)| {
            let (pool, _) = pda::pool(id);
            json!({ "poolId": id, "index": index, "pda": entry(pda::loss_event(&pool, index)) })
        })
        .collect();
    let sellers: Vec<Value> = POOL_IDS
        .iter()
        .map(|&id| {
            let (pool, _) = pda::pool(id);
            json!({
                "poolId": id,
                "owner": USER_A.to_string(),
                "pda": entry(pda::seller(&pool, &USER_A)),
            })
        })
        .collect();
    // Nonce — рядком: `u64::MAX` не вміщається у JSON-число без втрати.
    let contracts: Vec<Value> = NONCES
        .iter()
        .map(|&(id, nonce)| {
            let (pool, _) = pda::pool(id);
            json!({
                "poolId": id,
                "buyer": USER_B.to_string(),
                "nonce": nonce.to_string(),
                "pda": entry(pda::contract(&pool, &USER_B, nonce)),
            })
        })
        .collect();
    json!({
        "comment": "Згенеровано `cargo test --workspace -- --ignored gen_pda_fixture` (wsl-build.sh fixtures). Не правити руками: pda.test.ts звіряє кожну адресу з pda.ts.",
        "program": washapp::ID.to_string(),
        "config": entry(pda::config()),
        "mint": entry(pda::mint()),
        "treasury": entry(pda::treasury()),
        "pools": pools,
        "lossEvents": loss_events,
        "sellers": sellers,
        "contracts": contracts,
    })
}

#[test]
#[ignore = "генератор фікстури: wsl-build.sh fixtures"]
fn gen_pda_fixture() {
    let text = serde_json::to_string_pretty(&fixture()).unwrap() + "\n";
    std::fs::write(fixture_path(), text).unwrap();
}

// Фікстура застаріває мовчки: seeds змінились у `constants.rs`, а `pda.ts`
// далі зеленіє проти старих адрес. Цей тест тримає її прив'язаною до коду.
#[test]
fn pda_fixture_matches_seeds() {
    let path = fixture_path();
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("{}: {e} — wsl-build.sh fixtures", path.display()));
    let stored: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(
        stored,
        fixture(),
        "fixtures/pda.json застаріла — wsl-build.sh fixtures"
    );
}

fn collect_addresses(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            if let Some(Value::String(address)) = map.get("address") {
                out.push(address.clone());
            }
            map.values().for_each(|v| collect_addresses(v, out));
        }
        Value::Array(items) => items.iter().for_each(|v| collect_addresses(v, out)),
        _ => {}
    }
}

// Дві функції з одним seed-префіксом дали б однакові адреси для одного пулу —
// таку помилку копіювання видно лише на всій множині разом.
#[test]
fn fixture_addresses_are_distinct() {
    let mut addresses = Vec::new();
    collect_addresses(&fixture(), &mut addresses);
    let unique: HashSet<_> = addresses.iter().collect();
    assert_eq!(unique.len(), addresses.len());
    assert_eq!(addresses.len(), 3 + 6 * 3 + 3 + 3 + 3);
}

#[test]
fn pool_seed_uses_little_endian_id() {
    let (expected, _) = Pubkey::find_program_address(&[b"pool", &[0x01, 0x00]], &washapp::ID);
    assert_eq!(pda::pool(1).0, expected);
}
