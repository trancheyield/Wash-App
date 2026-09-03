// Читання стану з ланцюга: один `getMultipleAccounts` на пул (Pool + два мінти
// траншів — усі адреси виводяться з id без попереднього читання) і один на
// гаманець (три ATA). Декодери — Codama і `@solana-program/token`, тобто ті самі
// байти, що пише програма; звірено на `fixtures/accounts/m0.json`.

import {
  type Address,
  fetchEncodedAccounts,
  type GetMultipleAccountsApi,
  type MaybeEncodedAccount,
  type Rpc,
} from '@solana/kit'
import {
  decodeMint,
  decodeToken,
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token'
import type { Micro } from '@washapp/shared'
import { decodePool } from './generated/index.ts'
import { juniorMintAddress, poolAddress, seniorMintAddress } from './pda.ts'
import { type PoolView, poolView, type WalletView, walletView } from './view.ts'

export type ReadRpc = Rpc<GetMultipleAccountsApi>

function mintSupply(account: MaybeEncodedAccount, what: string): Micro {
  if (!account.exists) throw new Error(`${what} ${account.address} does not exist`)
  return decodeMint(account).data.supply
}

// ATA може не існувати (гаманець ще не торкався токена) — це нуль, не помилка.
function tokenAmount(account: MaybeEncodedAccount): Micro {
  return account.exists ? decodeToken(account).data.amount : 0n
}

export async function ataAddress(owner: Address, mint: Address): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS })
  return ata
}

export async function readPool(rpc: ReadRpc, id: number): Promise<PoolView | null> {
  const address = await poolAddress(id)
  const [seniorMint, juniorMint] = await Promise.all([
    seniorMintAddress(address),
    juniorMintAddress(address),
  ])
  const [pool, senior, junior] = await fetchEncodedAccounts<[string, string, string]>(rpc, [
    address,
    seniorMint,
    juniorMint,
  ])
  if (!pool.exists) return null
  return poolView(
    address,
    decodePool(pool).data,
    mintSupply(senior, 'senior mint'),
    mintSupply(junior, 'junior mint'),
  )
}

export async function readWallet(
  rpc: ReadRpc,
  pool: PoolView,
  owner: Address,
): Promise<WalletView> {
  const [base, senior, junior] = await Promise.all([
    ataAddress(owner, pool.mint),
    ataAddress(owner, pool.senior.mint),
    ataAddress(owner, pool.junior.mint),
  ])
  const accounts = await fetchEncodedAccounts<[string, string, string]>(rpc, [base, senior, junior])
  return walletView(
    owner,
    pool,
    tokenAmount(accounts[0]),
    tokenAmount(accounts[1]),
    tokenAmount(accounts[2]),
  )
}
