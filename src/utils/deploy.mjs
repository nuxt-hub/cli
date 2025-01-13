import { createHash } from 'node:crypto'
import { extname } from 'pathe'

export function hashFile(filepath, base64) {
  const extension = extname(filepath).substring(1)

  return createHash('sha1')
    .update(base64 + extension)
    .digest('hex')
    .slice(0, 32)
}
