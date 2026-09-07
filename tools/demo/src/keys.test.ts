import type { webcrypto } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createKeyPairSignerFromPrivateKeyBytes } from '@solana/kit'
import { afterEach, describe, expect, it } from 'vitest'
import { loadKeypair } from './keys.ts'
import { wsUrl } from './rpc.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function keysDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'washapp-keys-'))
  dirs.push(dir)
  return dir
}

describe('loadKeypair', () => {
  it('reads a solana-keygen file and derives the same public key', async () => {
    const dir = keysDir()
    // Файл solana-keygen — 32 секретних байти + 32 публічних; секрет беремо з
    // хвоста PKCS#8, публічний — сирим, як робить сам keygen.
    const pair = (await crypto.subtle.generateKey('Ed25519', true, [
      'sign',
      'verify',
    ])) as webcrypto.CryptoKeyPair
    const secretBytes = new Uint8Array(
      await crypto.subtle.exportKey('pkcs8', pair.privateKey),
    ).slice(-32)
    const publicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
    writeFileSync(join(dir, 'operator.json'), JSON.stringify([...secretBytes, ...publicBytes]))

    const signer = await loadKeypair(dir, 'operator')
    const reference = await createKeyPairSignerFromPrivateKeyBytes(secretBytes)
    expect(signer.address).toBe(reference.address)
  })

  it('rejects a file that is not 64 bytes', async () => {
    const dir = keysDir()
    writeFileSync(join(dir, 'operator.json'), JSON.stringify([1, 2, 3]))
    await expect(loadKeypair(dir, 'operator')).rejects.toThrow()
  })
})

describe('wsUrl', () => {
  it('swaps the scheme and keeps the api key query intact', () => {
    expect(wsUrl('https://devnet.helius-rpc.com/?api-key=k')).toBe(
      'wss://devnet.helius-rpc.com/?api-key=k',
    )
    expect(wsUrl('http://127.0.0.1:8899')).toBe('ws://127.0.0.1:8899')
  })
})
