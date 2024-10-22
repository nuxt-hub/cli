import { join } from 'pathe'
import { createStorage } from 'unstorage'
import fsDriver from 'unstorage/drivers/fs'
import { $api } from './data.mjs'

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

/**
 * @type {Promise<Array<{ results: Array, success: boolean, meta: object}>>}
 */
export const useDatabaseQuery = async (env, query) => {
  return await $api(`/projects/${process.env.NUXT_HUB_PROJECT_KEY}/database/${env}/query`, {
    method: 'POST',
    body: { query, mode: 'raw' }
  }).catch((error) => {
    if (error.response?.status === 400) {
      throw `NuxtHub database is not enabled on \`${env}\`. Deploy a new version with \`hub.database\` enabled and try again.`
    }
    throw error
  })
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

/**
 * @type {Promise<Array<{ id: number, name: string, applied_at: string }>>}
 */
export const getRemoteMigrations = async (env) => {
  const query = 'select "id", "name", "applied_at" from "hub_migrations" order by "hub_migrations"."id"'
  return (await useDatabaseQuery(env, query).catch((error) => {
    if (error.response?.status === 500 && error.response?._data?.message.includes('no such table')) {
      return []
    }
    throw ''
  }))?.[0]?.results ?? []
}

export const createMigrationsTable = async (env) => {
  const query = `CREATE TABLE IF NOT EXISTS hub_migrations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
  );`
  await useDatabaseQuery(env, query)
}