import { consola } from 'consola'
import { join } from 'pathe'
import { existsSync } from 'node:fs'
import { createStorage } from 'unstorage'
import fsDriver from 'unstorage/drivers/fs'
import { $api } from './data.mjs'
import { $fetch } from 'ofetch'

export async function queryDatabase({ env, url, token, query, params }) {
  if (url) {
    return queryRemoteDatabase({ url, token, query, params })
  }
  return $api(`/projects/${process.env.NUXT_HUB_PROJECT_KEY}/database/${env}/query`, {
    method: 'POST',
    body: { query, params }
  })
}

// Used for localhost or self-hosted projects
export async function queryRemoteDatabase({ url, token, query, params })  {
  const cloudflareAccessHeaders = process.env.NUXT_HUB_CLOUDFLARE_ACCESS_CLIENT_ID && process.env.NUXT_HUB_CLOUDFLARE_ACCESS_CLIENT_SECRET ? {
    'CF-Access-Client-Id': process.env.NUXT_HUB_CLOUDFLARE_ACCESS_CLIENT_ID,
    'CF-Access-Client-Secret': process.env.NUXT_HUB_CLOUDFLARE_ACCESS_CLIENT_SECRET
  } : undefined
  return await $fetch(`${url}/api/_hub/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      ...cloudflareAccessHeaders
    },
    body: { query, params }
  }).catch((error) => {
    if (error.message.includes('fetch failed')) {
      consola.error(`Could not connect to \`${url}/api/_hub/database/query\``)
      if (url.includes('localhost:')) {
        consola.warn('Please make sure to run the Nuxt development server with `npx nuxt dev`.')
      }
    }
    throw error
  })
}

let _migrationsDir
export function getMigrationsDir() {
  if (!_migrationsDir) {
    const cwd = process.cwd()
    _migrationsDir = existsSync(join(cwd, '.data/hub/database/migrations')) ? join(cwd, '.data/hub/database/migrations') : join(cwd, 'server/database/migrations')
  }
  return _migrationsDir
}

/**
 * @type {import('unstorage').Storage}
 */
let _storage
export function useMigrationsStorage() {
  if (!_storage) {
    _storage = createStorage({
      driver: fsDriver({
        base: getMigrationsDir(),
        ignore: ['.DS_Store']
      })
    })
  }
  return _storage
}

export async function getMigrationFiles() {
  const fileKeys = await useMigrationsStorage().getKeys()
  return fileKeys.filter(file => file.endsWith('.sql'))
}

export async function getNextMigrationNumber() {
  const files = await getMigrationFiles()
  const lastSequentialMigrationNumber = files
    .map(file => file.split('_')[0])
    .map(num => parseInt(num))
    .sort((a, b) => a - b)
    .pop() ?? 0

    return (lastSequentialMigrationNumber + 1).toString().padStart(4, '0')
}

export const CreateDatabaseMigrationsTableQuery = `CREATE TABLE IF NOT EXISTS _hub_migrations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);`
export const ListDatabaseMigrationsQuery = 'select "id", "name", "applied_at" from "_hub_migrations" order by "_hub_migrations"."id"'

export async function createMigrationsTable({ env, url, token }) {
  await queryDatabase({ env, url, token, query: CreateDatabaseMigrationsTableQuery })
}

/**
 * @type {Promise<Array<{ id: number, name: string, applied_at: string }>>}
 */
export async function fetchRemoteMigrations({ env, url, token }) {
  const res = await queryDatabase({ env, url, token, query: ListDatabaseMigrationsQuery }).catch((error) => {
    if (error.response?._data?.message.includes('no such table')) {
      return []
    }
    throw error.message
  })
  if (Array.isArray(res)) {
    return res[0]?.results ?? []
  }
  return res?.results ?? []
}
