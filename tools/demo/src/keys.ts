import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createKeyPairSignerFromBytes, type KeyPairSigner } from '@solana/kit'
import { z } from 'zod'

// Формат `solana-keygen`: JSON-масив із 64 байтів (32 секретних + 32 публічних).
const keypairFileSchema = z.array(z.number().int().min(0).max(255)).length(64)

export type KeyName = 'operator' | 'devnet-deployer'

// Тека ключів — поза репо (`WASH_KEYS_DIR`, типово WSL `~/.config/washapp`; з
// Windows — UNC-шлях `//wsl.localhost/<distro>/home/<user>/.config/washapp`).
export async function loadKeypair(keysDir: string, name: KeyName): Promise<KeyPairSigner> {
  const path = join(keysDir, `${name}.json`)
  const bytes = keypairFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  return createKeyPairSignerFromBytes(new Uint8Array(bytes))
}
