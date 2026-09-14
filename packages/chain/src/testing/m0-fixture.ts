// Стан брифу M0 після 30 модельних днів, знятий із SVM (`wsl-build.sh fixtures`,
// генератор `programs/washapp/tests/fixture_accounts.rs`), і розділ `afterLoss` —
// той самий пул після `record_loss 15 %` у тому ж слоті (аркуш 3 брифу). Адреси й
// байти тут — те, що реально записала програма, тож читачі й білдери звіряються
// з нею, а не самі з собою. Лише для тестів — з `index.ts` не експортується.

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
  genesisTs: z.number().int(),
  poolId: z.number().int().min(0).max(65_535),
  operator: addressSchema,
  owner: addressSchema,
  accounts: z.object({
    config: accountSchema,
    mint: accountSchema,
    treasury: accountSchema,
    pool: accountSchema,
    vault: accountSchema,
    seniorMint: accountSchema,
    juniorMint: accountSchema,
    ownerBase: accountSchema,
    ownerSenior: accountSchema,
    ownerJunior: accountSchema,
  }),
  afterLoss: z.object({
    lossBps: z.number().int().min(0).max(10_000),
    accounts: z.object({
      pool: accountSchema,
      vault: accountSchema,
      mint: accountSchema,
      lossEvent0: accountSchema,
    }),
  }),
})

export type M0Fixture = z.infer<typeof fixtureSchema>
export type M0AccountName = keyof M0Fixture['accounts']

export const m0Fixture: M0Fixture = fixtureSchema.parse(
  JSON.parse(
    readFileSync(new URL('../../../../fixtures/accounts/m0.json', import.meta.url), 'utf8'),
  ),
)

export function m0Address(name: M0AccountName) {
  return m0Fixture.accounts[name].address
}
