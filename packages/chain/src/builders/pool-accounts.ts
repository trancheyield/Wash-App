// Сім адрес, що стоять у кожній інструкції пулу, — усі PDA від `id`, тож білдер
// не потребує прочитаного `PoolView`; базовий мінт пулу — лише `Config.mint`
// (`has_one = mint`), тому й він виводиться, а не читається.

import type { Address } from '@solana/kit'
import { Tranche } from '../generated/index.ts'
import {
  configAddress,
  juniorMintAddress,
  mintAddress,
  poolAddress,
  seniorMintAddress,
  treasuryAddress,
  vaultAddress,
} from '../pda.ts'

export type PoolAccounts = {
  config: Address
  mint: Address
  treasury: Address
  pool: Address
  vault: Address
  seniorMint: Address
  juniorMint: Address
}

export async function poolAccounts(id: number): Promise<PoolAccounts> {
  const pool = await poolAddress(id)
  const [config, mint, treasury, vault, seniorMint, juniorMint] = await Promise.all([
    configAddress(),
    mintAddress(),
    treasuryAddress(),
    vaultAddress(pool),
    seniorMintAddress(pool),
    juniorMintAddress(pool),
  ])
  return { config, mint, treasury, pool, vault, seniorMint, juniorMint }
}

// `Tranche` з Codama — числовий (`Senior = 0`, `Junior = 1`), як borsh-enum у програмі.
export function trancheMint(accounts: PoolAccounts, tranche: Tranche): Address {
  return tranche === Tranche.Senior ? accounts.seniorMint : accounts.juniorMint
}
