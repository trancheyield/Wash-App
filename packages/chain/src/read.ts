// Читання стану з ланцюга: один `getMultipleAccounts` на пул (Pool + два мінти
// траншів + перші події збитку — усі адреси виводяться з id без попереднього
// читання). Декодери — Codama і `@solana-program/token`, тобто ті самі байти,
// що пише програма; звірено на `fixtures/accounts/m0.json`.
// The wallet and protection reads are described at `readWallet` and `readContracts`;
// they are checked against `fixtures/accounts/protection.json`.

import {
  type Address,
  type Base58EncodedBytes,
  fetchEncodedAccounts,
  type GetMultipleAccountsApi,
  type GetProgramAccountsApi,
  getBase58Decoder,
  type MaybeEncodedAccount,
  parseBase64RpcAccount,
  type Rpc,
} from '@solana/kit'
import {
  decodeMint,
  decodeToken,
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token'
import type { Micro } from '@washapp/shared'
import {
  decodeLossEvent,
  decodePool,
  decodeProtectionContract,
  decodeProtectionPool,
  decodeSellerPosition,
  getProtectionContractSize,
  PROTECTION_CONTRACT_DISCRIMINATOR,
  WASHAPP_PROGRAM_ADDRESS,
} from './generated/index.ts'
import {
  addressBytes,
  juniorMintAddress,
  lossEventAddress,
  poolAddress,
  protectionAddress,
  sellerAddress,
  seniorMintAddress,
} from './pda.ts'
import {
  type ContractView,
  contractView,
  type LossEventView,
  lossEventView,
  type PoolView,
  type ProtectionView,
  poolView,
  protectionView,
  type WalletView,
  walletView,
} from './view.ts'

export type ReadRpc = Rpc<GetMultipleAccountsApi & GetProgramAccountsApi>

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

function maybeProtection(account: MaybeEncodedAccount): ProtectionView | null {
  return account.exists ? protectionView(account.address, decodeProtectionPool(account).data) : null
}

// A pool without `init_protection` has no protection market — `null`, not an error.
export async function readProtection(rpc: ReadRpc, pool: Address): Promise<ProtectionView | null> {
  const [account] = await fetchEncodedAccounts(rpc, [await protectionAddress(pool)])
  return account ? maybeProtection(account) : null
}

// `ProtectionContract` starts `discriminator(8) | pool(32) | buyer(32)`.
const CONTRACT_POOL_OFFSET = 8n
const CONTRACT_BUYER_OFFSET = 40n

function memcmp(offset: bigint, bytes: Uint8Array) {
  return {
    memcmp: {
      offset,
      bytes: getBase58Decoder().decode(bytes) as Base58EncodedBytes,
      encoding: 'base58' as const,
    },
  }
}

// Nonces come from one pool-wide counter, so a buyer's contracts are scattered over
// `0..contracts`; one `getProgramAccounts` filtered by pool and buyer finds them without
// deriving and fetching every nonce. Contracts are never closed, so a settled or expired
// one is still here with its status.
export async function readContracts(
  rpc: ReadRpc,
  pool: Address,
  buyer: Address,
): Promise<ContractView[]> {
  const accounts = await rpc
    .getProgramAccounts(WASHAPP_PROGRAM_ADDRESS, {
      encoding: 'base64',
      filters: [
        { dataSize: BigInt(getProtectionContractSize()) },
        memcmp(0n, new Uint8Array(PROTECTION_CONTRACT_DISCRIMINATOR)),
        memcmp(CONTRACT_POOL_OFFSET, addressBytes(pool)),
        memcmp(CONTRACT_BUYER_OFFSET, addressBytes(buyer)),
      ],
    })
    .send()
  return accounts
    .map(({ pubkey, account }) => {
      const decoded = decodeProtectionContract(parseBase64RpcAccount(pubkey, account))
      return contractView(pubkey, decoded.data)
    })
    .sort((a, b) => (a.nonce < b.nonce ? -1 : a.nonce > b.nonce ? 1 : 0))
}

// One `getMultipleAccounts` for the three ATAs, the protection pool and the seller
// position, plus one `getProgramAccounts` for contracts — skipped when the pool has no
// protection market, since no contract can exist there.
export async function readWallet(
  rpc: ReadRpc,
  pool: PoolView,
  owner: Address,
): Promise<WalletView> {
  const [base, senior, junior, protection, position] = await Promise.all([
    ataAddress(owner, pool.mint),
    ataAddress(owner, pool.senior.mint),
    ataAddress(owner, pool.junior.mint),
    protectionAddress(pool.address),
    sellerAddress(pool.address, owner),
  ])
  const accounts = await fetchEncodedAccounts<[string, string, string, string, string]>(rpc, [
    base,
    senior,
    junior,
    protection,
    position,
  ])
  const market = maybeProtection(accounts[3])
  const shares = accounts[4].exists ? decodeSellerPosition(accounts[4]).data.shares : 0n
  const contracts = market ? await readContracts(rpc, pool.address, owner) : []
  return walletView(
    owner,
    pool,
    tokenAmount(accounts[0]),
    tokenAmount(accounts[1]),
    tokenAmount(accounts[2]),
    { shares, protection: market },
    contracts,
  )
}
