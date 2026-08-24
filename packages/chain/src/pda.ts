import {
  type Address,
  getAddressEncoder,
  getProgramDerivedAddress,
  getU16Encoder,
  getU32Encoder,
  getU64Encoder,
} from '@solana/kit'
import { WASHAPP_PROGRAM_ADDRESS } from './program.ts'

// Дзеркало `programs/washapp/src/constants.rs`; кожна адреса звірена з Rust
// через `fixtures/pda.json` (`pda.test.ts`). Числові seeds — little-endian,
// як `to_le_bytes()` на боці програми.
const CONFIG_SEED = 'config'
const MINT_SEED = 'mint'
const TREASURY_SEED = 'treasury'
const POOL_SEED = 'pool'
const VAULT_SEED = 'vault'
const SENIOR_MINT_SEED = 'senior'
const JUNIOR_MINT_SEED = 'junior'
const LOSS_SEED = 'loss'
const PROTECTION_SEED = 'protection'
const PVAULT_SEED = 'pvault'
const SELLER_SEED = 'seller'
const CONTRACT_SEED = 'contract'

type Seed = string | Uint8Array

async function derive(seeds: readonly Seed[]): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: WASHAPP_PROGRAM_ADDRESS,
    seeds: [...seeds],
  })
  return pda
}

export function addressBytes(value: Address): Uint8Array {
  return new Uint8Array(getAddressEncoder().encode(value))
}

// Кодери kit самі відкидають значення поза межами типу (u16/u32/u64) —
// id пулу понад 65 535 не стане мовчки іншим пулом.
const u16 = (value: number): Uint8Array => new Uint8Array(getU16Encoder().encode(value))
const u32 = (value: number): Uint8Array => new Uint8Array(getU32Encoder().encode(value))
const u64 = (value: bigint): Uint8Array => new Uint8Array(getU64Encoder().encode(value))

export async function configAddress(): Promise<Address> {
  return derive([CONFIG_SEED])
}

export async function mintAddress(): Promise<Address> {
  return derive([MINT_SEED])
}

export async function treasuryAddress(): Promise<Address> {
  return derive([TREASURY_SEED])
}

export async function poolAddress(id: number): Promise<Address> {
  return derive([POOL_SEED, u16(id)])
}

export async function vaultAddress(pool: Address): Promise<Address> {
  return derive([VAULT_SEED, addressBytes(pool)])
}

export async function seniorMintAddress(pool: Address): Promise<Address> {
  return derive([SENIOR_MINT_SEED, addressBytes(pool)])
}

export async function juniorMintAddress(pool: Address): Promise<Address> {
  return derive([JUNIOR_MINT_SEED, addressBytes(pool)])
}

export async function lossEventAddress(pool: Address, index: number): Promise<Address> {
  return derive([LOSS_SEED, addressBytes(pool), u32(index)])
}

export async function protectionAddress(pool: Address): Promise<Address> {
  return derive([PROTECTION_SEED, addressBytes(pool)])
}

export async function pvaultAddress(pool: Address): Promise<Address> {
  return derive([PVAULT_SEED, addressBytes(pool)])
}

export async function sellerAddress(pool: Address, owner: Address): Promise<Address> {
  return derive([SELLER_SEED, addressBytes(pool), addressBytes(owner)])
}

// Nonce — `bigint`: лічильник `ProtectionPool.contracts` — u64, `Number` його не вміщає.
export async function contractAddress(
  pool: Address,
  buyer: Address,
  nonce: bigint,
): Promise<Address> {
  return derive([CONTRACT_SEED, addressBytes(pool), addressBytes(buyer), u64(nonce)])
}
