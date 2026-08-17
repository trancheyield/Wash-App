import { type Address, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit'
import { WASHAPP_PROGRAM_ADDRESS } from './program.ts'

const CONFIG_SEED = 'config'

export async function configAddress(): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: WASHAPP_PROGRAM_ADDRESS,
    seeds: [CONFIG_SEED],
  })
  return pda
}

export function addressBytes(value: Address): Uint8Array {
  return new Uint8Array(getAddressEncoder().encode(value))
}
