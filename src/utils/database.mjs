import { join } from 'pathe'
import { createStorage } from 'unstorage'
import fsDriver from 'unstorage/drivers/fs'

/**
 * @type {import('unstorage').Storage}
 */
let _storage
export const useMigrationsStorage = () => {
  if (!_storage) {
    const cwd = process.cwd()
    const migrationsDir = join(cwd, 'server/database/migrations')
    _storage = createStorage({
      driver: fsDriver({
        base: migrationsDir,
        ignore: ['.DS_Store']
      }),
    })
  }
  return _storage
}

export const getMigrationFiles = async () => {
  const fileKeys = await useMigrationsStorage().getKeys()
  return fileKeys.filter(file => file.endsWith('.sql'))
}

export const getNextMigrationNumber = async () => {
  const files = await getMigrationFiles()
  const lastSequentialMigrationNumber = files
    .map(file => file.split('_')[0])
    .map(num => parseInt(num))
    .sort((a, b) => a - b)
    .pop() ?? 0

  return (lastSequentialMigrationNumber + 1).toString().padStart(4, '0')
}
