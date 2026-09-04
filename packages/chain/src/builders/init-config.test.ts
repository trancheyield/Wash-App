import { AccountRole, createNoopSigner } from '@solana/kit'
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system'
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token'
import { describe, expect, it } from 'vitest'
import {
  INIT_CONFIG_DISCRIMINATOR,
  parseInitConfigInstruction,
  WASHAPP_PROGRAM_ADDRESS,
} from '../generated/index.ts'
import { m0Address, m0Fixture } from '../testing/m0-fixture.ts'
import { buildInitConfig } from './init-config.ts'

// Round-trip: зібрану інструкцію декодуємо назад і звіряємо кожне поле — кодери kit
// пишуть `undefined` як 0, тож зелений encode сам по собі нічого не доводить.
// Адреси — з `fixtures/accounts/m0.json`, тобто ті, що вивела програма в SVM.
describe('buildInitConfig', () => {
  it('round-trips faucet cap and resolves config, mint and treasury PDAs', async () => {
    const authority = createNoopSigner(m0Fixture.operator)
    const faucetCap = 10_000_000_000n

    const parsed = parseInitConfigInstruction(await buildInitConfig({ authority, faucetCap }))

    expect(parsed.programAddress).toBe(WASHAPP_PROGRAM_ADDRESS)
    expect(parsed.data).toEqual({ discriminator: INIT_CONFIG_DISCRIMINATOR, faucetCap })
    expect(parsed.accounts.config.address).toBe(m0Address('config'))
    expect(parsed.accounts.mint.address).toBe(m0Address('mint'))
    expect(parsed.accounts.treasury.address).toBe(m0Address('treasury'))
    expect(parsed.accounts.authority.address).toBe(m0Fixture.operator)
    // Authority платить за три `init` — має бути writable signer.
    expect(parsed.accounts.authority.role).toBe(AccountRole.WRITABLE_SIGNER)
    expect(parsed.accounts.tokenProgram.address).toBe(TOKEN_PROGRAM_ADDRESS)
    expect(parsed.accounts.systemProgram.address).toBe(SYSTEM_PROGRAM_ADDRESS)
  })
})
