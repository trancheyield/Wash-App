// The protection market on the M0 pool, taken from SVM (`wsl-build.sh fixtures`, generator
// `programs/washapp/tests/fixture_accounts.rs`): the seller's collateral, two contracts of the
// buyer and one of the seller, a 15 % loss and the first contract settled on it. The protection
// builders and readers are checked against the addresses and bytes the program really wrote.
// Tests only — not exported from `index.ts`.

import { readFileSync } from 'node:fs'
import { addressSchema } from '@washapp/shared'
import { z } from 'zod'

const accountSchema = z.object({
  address: addressSchema,
  owner: addressSchema,
  lamports: z.number().int().nonnegative(),
  data: z.string().regex(/^([0-9a-f]{2})*$/),
})

const fixtureSchema = z.object({
  poolId: z.number().int().min(0).max(65_535),
  operator: addressSchema,
  seller: addressSchema,
  buyer: addressSchema,
  term: z.number().int().positive(),
  lossBps: z.number().int().min(0).max(10_000),
  accounts: z.object({
    protection: accountSchema,
    pvault: accountSchema,
    sellerPosition: accountSchema,
    sellerBase: accountSchema,
    buyerBase: accountSchema,
    contract0: accountSchema,
    contract1: accountSchema,
    contract2: accountSchema,
    lossEvent0: accountSchema,
  }),
})

export type ProtectionFixture = z.infer<typeof fixtureSchema>
export type ProtectionAccountName = keyof ProtectionFixture['accounts']

export const protectionFixture: ProtectionFixture = fixtureSchema.parse(
  JSON.parse(
    readFileSync(new URL('../../../../fixtures/accounts/protection.json', import.meta.url), 'utf8'),
  ),
)

export function protectionFixtureAddress(name: ProtectionAccountName) {
  return protectionFixture.accounts[name].address
}
