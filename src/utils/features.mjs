export const FEATURE_CONFIG = {
  'ai': {
    key: 'ai',
    docs: 'https://hub.nuxt.com/docs/features/ai',
  },
  'autorag': {
    key: 'ai',
    docs: 'https://hub.nuxt.com/docs/features/autorag',
  },
  'blob': {
    key: 'blob',
    docs: 'https://hub.nuxt.com/docs/features/blob',
  },
  'browser': {
    key: 'browser',
    docs: 'https://hub.nuxt.com/docs/features/browser',
  },
  'cache': {
    key: 'cache',
    docs: 'https://hub.nuxt.com/docs/features/cache',
  },
  'database': {
    key: 'database',
    docs: 'https://hub.nuxt.com/docs/features/database',
  },
  'kv': {
    key: 'kv',
    docs: 'https://hub.nuxt.com/docs/features/kv',
  },
  'openapi': {
    key: null,
    docs: 'https://hub.nuxt.com/docs/features/openapi',
    nitroExperimental: {
      openAPI: true
    }
  },
  'realtime': {
    key: 'workers',
    docs: 'https://hub.nuxt.com/docs/features/realtime',
    nitroExperimental: {
      websocket: true
    }
  },
  'vectorize': {
    key: 'vectorize',
    docs: 'https://hub.nuxt.com/docs/features/vectorize#getting-started',
    requiresConfig: true
  },
}

export function getFeatureConfig(feature) {
  return FEATURE_CONFIG[feature]
}

export function isValidFeature(feature) {
  return Object.keys(FEATURE_CONFIG).includes(feature)
}

export function isFeatureEnabled(nuxtConfig, featureConfig) {
  const featureKey = featureConfig.key
  const hubConfig = nuxtConfig.hub || {}

  if (featureKey && hubConfig[featureKey] === true) {
    return true
  }

  if (!featureKey && featureConfig.nitroExperimental && nuxtConfig.nitro?.experimental) {
    return Object.entries(featureConfig.nitroExperimental).every(
      ([key, value]) => nuxtConfig.nitro.experimental[key] === value
    )
  }

  return false
}
