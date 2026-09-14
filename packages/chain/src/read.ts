// Читання стану з ланцюга: один `getMultipleAccounts` на пул (Pool + два мінти
// траншів + перші події збитку — усі адреси виводяться з id без попереднього
// читання) і один на гаманець (три ATA). Декодери — Codama і
// `@solana-program/token`, тобто ті самі байти, що пише програма; звірено на
// `fixtures/accounts/m0.json`.

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
import { decodeLossEvent, decodePool } from './generated/index.ts'
import { juniorMintAddress, lossEventAddress, poolAddress, seniorMintAddress } from './pda.ts'
import {
  type LossEventView,
  lossEventView,
  type PoolView,
  poolView,
  type WalletView,
  walletView,
} from './view.ts'

export type ReadRpc = Rpc<GetMultipleAccountsApi>

// Скільки подій збитку читається разом із пулом наосліп, ще не знаючи
// `loss_count`: демо дає одну-дві, тож сторінка пулу — один виклик RPC.
export const EAGER_LOSS_EVENTS = 5
// Стеля `getMultipleAccounts` на один виклик.
const BATCH = 100

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

function lossEvent(account: MaybeEncodedAccount, index: number): LossEventView {
  // Індекс нижчий за `loss_count` — подія мусить існувати: її пише та сама
  // інструкція, що збільшує лічильник.
  if (!account.exists) throw new Error(`loss event ${index} ${account.address} does not exist`)
  return lossEventView(account.address, decodeLossEvent(account).data)
}

async function lossEventAddresses(pool: Address, from: number, to: number): Promise<Address[]> {
  return Promise.all(
    Array.from({ length: Math.max(0, to - from) }, (_, i) => lossEventAddress(pool, from + i)),
  )
}

// Події `from..lossCount` пакетами по 100 — для хвоста, що не влізе в перший виклик.
export async function readLossEvents(
  rpc: ReadRpc,
  pool: Address,
  lossCount: number,
  from = 0,
): Promise<LossEventView[]> {
  const events: LossEventView[] = []
  for (let start = from; start < lossCount; start += BATCH) {
    const end = Math.min(start + BATCH, lossCount)
    const addresses = await lossEventAddresses(pool, start, end)
    const accounts = await fetchEncodedAccounts(rpc, addresses)
    events.push(...accounts.map((account, i) => lossEvent(account, start + i)))
  }
  return events
}

export async function readPool(rpc: ReadRpc, id: number): Promise<PoolView | null> {
  const address = await poolAddress(id)
  const [seniorMint, juniorMint, eager] = await Promise.all([
    seniorMintAddress(address),
    juniorMintAddress(address),
    lossEventAddresses(address, 0, EAGER_LOSS_EVENTS),
  ])
  const [pool, senior, junior, ...lossAccounts] = await fetchEncodedAccounts(rpc, [
    address,
    seniorMint,
    juniorMint,
    ...eager,
  ])
  if (!pool || !senior || !junior || !pool.exists) return null
  const data = decodePool(pool).data
  const known = lossAccounts.slice(0, data.lossCount).map((account, i) => lossEvent(account, i))
  const rest = await readLossEvents(rpc, address, data.lossCount, known.length)
  return poolView(
    address,
    data,
    mintSupply(senior, 'senior mint'),
    mintSupply(junior, 'junior mint'),
    [...known, ...rest],
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
