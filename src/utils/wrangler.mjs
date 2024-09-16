import { stringifyTOML } from 'confbox'

// Taken from https://github.com/nuxt-hub/core/blob/main/src/utils/wrangler.ts
// With some modifications to fit the needs of this project
export function generateWrangler(hub) {
  const wrangler = {}

  if (hub.bindings?.compatibilityFlags) {
    wrangler['compatibility_flags'] = hub.bindings.compatibilityFlags
  } else {
    wrangler['compatibility_flags'] = ['nodejs_compat']
  }

  if (hub.bindings?.compatibilityDate) {
    wrangler['compatibility_date'] = hub.bindings.compatibilityDate
  }
  if (hub.ai) {
    wrangler['ai'] = {
      binding: 'AI'
    }
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

  if (hub.kv) {
    wrangler['kv_namespaces'] = [{
      binding: 'KV',
      id: 'kv_default'
    }]
  }

  if (hub.database) {
    wrangler['d1_databases'] = [{
      binding: 'DB',
      database_name: 'default',
      database_id: 'default'
    }]
  }

  return stringifyTOML(wrangler)
}
