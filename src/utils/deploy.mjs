import { createHash } from 'node:crypto'

export function hashFile(data) {
  return createHash('sha256')
    .update(data)
    .digest('hex')
    .slice(0, 32) // required by Cloudflare
}
