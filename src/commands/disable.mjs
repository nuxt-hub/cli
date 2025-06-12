import { consola } from 'consola'
import { colors } from 'consola/utils'
import { defineCommand } from 'citty'
import {
  getNuxtConfig,
  getFeatureConfig,
  isValidFeature,
  isFeatureEnabled,
  FEATURE_CONFIG
} from '../utils/index.mjs'
import { updateConfig } from 'c12/update'

function removeFeatureConfig(config, featureConfig) {
  const featureKey = featureConfig.key

  if (featureKey && config.hub && config.hub[featureKey] === true) {
    delete config.hub[featureKey]

    if (Object.keys(config.hub).length === 0) {
      delete config.hub
    }
  }

  if (featureConfig.nitroExperimental && config.nitro?.experimental) {
    Object.keys(featureConfig.nitroExperimental).forEach(key => {
      if (config.nitro.experimental[key] !== undefined) {
        delete config.nitro.experimental[key]
      }
    })

    if (Object.keys(config.nitro.experimental).length === 0) {
      delete config.nitro.experimental

      if (Object.keys(config.nitro).length === 0) {
        delete config.nitro
      }
    }
  }
}

export default defineCommand({
  meta: {
    name: 'disable',
    description: 'Disable a specific NuxtHub feature in your project.',
  },
  args: {
    feature: {
      type: 'positional',
      description: 'The NuxtHub feature to disable (ai, autorag, blob, browser, cache, database, kv, openapi, realtime, vectorize)',
      required: true,
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
    const cwd = process.cwd()
    const nuxtConfig = await getNuxtConfig(cwd)

    // check if feature is enabled
    if (!isFeatureEnabled(nuxtConfig, featureConfig)) {
      consola.info(`NuxtHub ${colors.cyan(feature)} feature is not enabled in this project.`)
      return 0
    }

    try {
      await updateConfig({
        cwd,
        configFile: 'nuxt.config',
        onUpdate: (config) => {
          if (!isFeatureEnabled(config, featureConfig)) {
            consola.info(`NuxtHub ${colors.cyan(feature)} feature is not enabled in this project.`)
            return false
          }
          removeFeatureConfig(config, featureConfig)
        }
      })

      consola.success(`NuxtHub ${colors.cyan(feature)} feature has been disabled in your project.`)
    } catch (error) {
      consola.error(`Failed to disable ${colors.cyan(feature)}: ${error.message}`)
      return 1
    }

    return 0
  },
})
