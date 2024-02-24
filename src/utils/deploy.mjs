import { extname } from 'pathe'
import { hash as blake3hash } from 'blake3-wasm'

// https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/src/pages/hash.ts#L5
export function hashFile (filepath, base64) {
  const extension = extname(filepath).substring(1)

  return blake3hash(base64 + extension)
    .toString('hex')
    .slice(0, 32)
}
