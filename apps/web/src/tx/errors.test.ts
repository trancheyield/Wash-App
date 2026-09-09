import { signature } from '@solana/kit'
import { describe, expect, it } from 'vitest'
import { explainSendError } from './errors.ts'
import { TransactionExpiredError, TransactionFailedError } from './send.ts'

const SIG = signature(
  '8kqJGiHfLqNgSH88upoF3N4ycUm7xsVG7gLngU9fhFqTj2zw86Qwiz27P6htj2kysvYJ1rhKLTpie4j4A5s67EM',
)

describe('explainSendError', () => {
  it('names the program error behind a Custom code', () => {
    const err = new TransactionFailedError(SIG, { InstructionError: [1, { Custom: 6003 }] })
    expect(explainSendError(err)).toBe(
      'refused by the program: junior share would fall below the pool minimum',
    )
  })

  it('keeps foreign custom codes and non-custom errors readable', () => {
    expect(
      explainSendError(new TransactionFailedError(SIG, { InstructionError: [0, { Custom: 1 }] })),
    ).toBe('transaction failed with program error 1')
    expect(
      explainSendError(
        new TransactionFailedError(SIG, { InstructionError: [0, 'InvalidArgument'] }),
      ),
    ).toContain('InvalidArgument')
  })

  it('explains expiry and passes wallet errors through', () => {
    expect(explainSendError(new TransactionExpiredError(SIG))).toContain('expired')
    expect(explainSendError(new Error('User rejected the request'))).toBe(
      'User rejected the request',
    )
  })
})
