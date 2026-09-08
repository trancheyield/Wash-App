import { signature } from '@solana/kit'
import { describe, expect, it } from 'vitest'
import {
  outcomeOf,
  TransactionExpiredError,
  TransactionFailedError,
  waitForConfirmation,
} from './send.ts'

const sig = signature(
  '2SLRczaqeENkutofXZNeeVAoCP2Sg5zVUQ8ixEAV3ue8vSkrfDmdf27rRHny6fp7MqCNbALGhMtdHtq7RsXuz2Lr',
)

type Status = Parameters<typeof outcomeOf>[0]
type FakeRpc = Parameters<typeof waitForConfirmation>[0]

const status = (
  confirmationStatus: 'processed' | 'confirmed' | 'finalized',
  err: unknown = null,
): Status =>
  ({ confirmationStatus, confirmations: 0n, err, slot: 1n, status: { Ok: null } }) as Status

// Фейковий RPC: черга відповідей статусу і висота блоку, що росте на одиницю за опитування.
function fakeRpc(statuses: Status[], startHeight = 100n) {
  let height = startHeight
  const calls = { statuses: 0, heights: 0 }
  const rpc = {
    getSignatureStatuses: () => ({
      send: async () => {
        calls.statuses += 1
        return { context: { slot: 1n }, value: [statuses.shift() ?? null] }
      },
    }),
    getBlockHeight: () => ({
      send: async () => {
        calls.heights += 1
        height += 1n
        return height
      },
    }),
  }
  return { rpc: rpc as unknown as FakeRpc, calls }
}

describe('outcomeOf', () => {
  it('treats missing and processed as pending, confirmed and finalized as done', () => {
    expect(outcomeOf(null)).toBe('pending')
    expect(outcomeOf(status('processed'))).toBe('pending')
    expect(outcomeOf(status('confirmed'))).toBe('confirmed')
    expect(outcomeOf(status('finalized'))).toBe('confirmed')
  })

  it('reports a chain error as failed whatever the commitment', () => {
    expect(outcomeOf(status('confirmed', { InstructionError: [0, 'Custom'] }))).toBe('failed')
  })
})

describe('waitForConfirmation', () => {
  it('polls until the status reaches confirmed', async () => {
    const { rpc, calls } = fakeRpc([null, status('processed'), status('confirmed')])
    await waitForConfirmation(rpc, sig, 1_000n, { pollMs: 0 })
    expect(calls.statuses).toBe(3)
    expect(calls.heights).toBe(2)
  })

  it('throws the chain error on a failed transaction', async () => {
    const { rpc } = fakeRpc([status('confirmed', { InsufficientFundsForFee: {} })])
    await expect(waitForConfirmation(rpc, sig, 1_000n, { pollMs: 0 })).rejects.toBeInstanceOf(
      TransactionFailedError,
    )
  })

  it('gives up once the block height passes lastValidBlockHeight', async () => {
    const { rpc, calls } = fakeRpc([], 100n)
    await expect(waitForConfirmation(rpc, sig, 102n, { pollMs: 0 })).rejects.toBeInstanceOf(
      TransactionExpiredError,
    )
    // Висоти 101 і 102 ще дійсні, 103 — за межею.
    expect(calls.heights).toBe(3)
  })

  it('stops on abort', async () => {
    const controller = new AbortController()
    const { rpc } = fakeRpc([null, null, null, null], 0n)
    const pending = waitForConfirmation(rpc, sig, 1_000n, {
      pollMs: 10_000,
      signal: controller.signal,
    })
    controller.abort(new Error('user left'))
    await expect(pending).rejects.toThrow('user left')
  })
})
