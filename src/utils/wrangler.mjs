import { stringifyTOML } from 'confbox'

// Taken from https://github.com/nuxt-hub/core/blob/main/src/utils/wrangler.ts
// With some modifications to fit the needs of this project
export function generateWrangler(hub, { preset } = {}) {
  const wrangler = {}

  // Workers specific settings
  if (preset === 'cloudflare-module' || preset === 'cloudflare-durable') {
    wrangler.name = 'nuxthub-local-preview'
    wrangler.main = './server/index.mjs'
    wrangler.assets = { directory: './public/', binding: 'ASSETS' }
    if (preset === 'cloudflare-durable') {
      wrangler.durable_objects ||= {}
      wrangler.durable_objects.bindings = [{ name: '$DurableObject', class_name: '$DurableObject' }]
      wrangler.migrations = [{ tag: 'v1', new_sqlite_classes: ['$DurableObject'] }]
    }
  }

  if (hub.bindings?.compatibilityFlags) {
    wrangler['compatibility_flags'] = hub.bindings.compatibilityFlags
  } else {
    wrangler['compatibility_flags'] = ['nodejs_compat']
  }

  if (hub.bindings?.compatibilityDate) {
    wrangler['compatibility_date'] = hub.bindings.compatibilityDate
  } else {
    wrangler['compatibility_date'] = new Date().toISOString().split('T')[0]
  }

  if (hub.ai) {
    wrangler['ai'] = {
      binding: 'AI'
    }
  }

  if (hub.browser) {
    wrangler['browser'] = { binding: 'BROWSER' }
  }

  if (hub.analytics) {
    wrangler['analytics_engine_datasets'] = [{
      binding: 'ANALYTICS',
      dataset: 'default'
    }]
  }

  if (hub.blob) {
    wrangler['r2_buckets'] = [{
      binding: 'BLOB',
      bucket_name: 'default'
    }]
  }

  if (hub.kv || hub.cache) {
    wrangler['kv_namespaces'] = []
  }
  if (hub.kv) {
    wrangler['kv_namespaces'].push({
      binding: 'KV',
      id: 'kv_default'
    })
  }
  if (hub.cache) {
    wrangler['kv_namespaces'].push({
      binding: 'CACHE',
      id: 'cache_default'
    })
  }

  if (hub.database) {
    wrangler['d1_databases'] = [{
      binding: 'DB',
      database_name: 'default',
      database_id: 'default',
      migrations_table: '_hub_migrations',
      migrations_dir: 'database/migrations'
    }]
  }

  return stringifyTOML(wrangler)
}
