import { consola } from 'consola'
import { colors } from 'consola/utils'
import { defineCommand } from 'citty'
import { getNuxtConfig } from '../utils/index.mjs'
import open from 'open'
import { updateConfig } from 'c12/update'


const FEATURE_CONFIG = {
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
    key: 'openapi',
    docs: 'https://hub.nuxt.com/docs/features/openapi',
  },
  'realtime': {
    key: 'realtime',
    docs: 'https://hub.nuxt.com/docs/features/realtime',
  },
  'vectorize': {
    key: 'vectorize',
    docs: 'https://hub.nuxt.com/docs/features/vectorize#getting-started',
    requiresConfig: true
  },
}

function getFeatureConfig(feature) {
  return FEATURE_CONFIG[feature]
}

function isValidFeature(feature) {
  return Object.keys(FEATURE_CONFIG).includes(feature)
}

export default defineCommand({
  meta: {
    name: 'enable',
    description: 'Enable a specific NuxtHub feature in your project.',
  },
  args: {
    feature: {
      type: 'positional',
      description: 'The NuxtHub feature to enable (ai, autorag, blob, browser, cache, database, kv, openapi, realtime,  vectorize)',
      required: true,
    },
    docs: {
      type: 'boolean',
      description: 'Open the documentation after enabling the feature.',
      default: false
    }
  },
  async run({ args }) {
    const feature = args.feature.toLowerCase()

    if (!isValidFeature(feature)) {
      consola.error(`Invalid feature: ${colors.red(feature)}`)
      consola.info(`Available features: ${Object.keys(FEATURE_CONFIG).map(f => colors.cyan(f)).join(', ')}`)
      return 1
    }

    const featureConfig = getFeatureConfig(feature)
    const featureKey = featureConfig.key
    const requiresConfig = featureConfig.requiresConfig

    const cwd = process.cwd()
    const nuxtConfig = await getNuxtConfig(cwd)

    const hubConfig = nuxtConfig.hub || {}

    if (hubConfig[featureKey] === true) {
      consola.info(`NuxtHub ${colors.cyan(featureKey)} feature is already enabled in this project.`)
    } else {

      if (requiresConfig) {
        consola.warn(`The ${colors.cyan(featureKey)} feature requires additional configuration and cannot be enabled with just a flag.`)
        consola.info(`Please refer to the documentation for configuration details: ${colors.underline(featureConfig.docs)}`)

        // managing exit codes
        return 1
      }

      try {
        const { created } = await updateConfig({
          cwd,
          configFile: 'nuxt.config',

          // if the config file doesn't exist, create it
          onCreate: () => {
            consola.info(`Creating new Nuxt config with ${colors.cyan(featureKey)} feature enabled...`)
            return `export default defineNuxtConfig({
  hub: {
    ${featureKey}: true
  }
})`
          },

          onUpdate: (config) => {
            config.hub = config.hub || {}
            if (config.hub[featureKey] === true) {
              consola.info(`NuxtHub ${colors.cyan(featureKey)} feature is already enabled in this project.`)
              return false
            }

            config.hub[featureKey] = true
          }
        })

        if (created) {
          consola.success(`Created new Nuxt config with ${colors.cyan(featureKey)} feature enabled.`)
        } else {
          consola.success(`NuxtHub ${colors.cyan(featureKey)} feature has been enabled in your project.`)
        }
      } catch (error) {
        consola.error(`Failed to enable ${colors.cyan(featureKey)}: ${error.message}`)
        return 1
      }
    }

    const docsUrl = featureConfig.docs

    if (!requiresConfig || hubConfig[featureKey] !== true) {
      consola.info(`Learn more about the ${colors.cyan(feature)} feature at: ${colors.underline(docsUrl)}`)
    }

    if (args.docs) {
      consola.info(`Opening documentation at ${colors.cyan(docsUrl)}...`)
      open(docsUrl)
    }

    return 0
  },
})
