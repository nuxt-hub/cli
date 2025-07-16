import { consola } from 'consola'
import { colors } from 'consola/utils'
import { defineCommand } from 'citty'
import { getNuxtConfig, getFeatureConfig, isValidFeature, isFeatureEnabled, FEATURE_CONFIG } from '../utils/index.mjs'
import { updateConfig } from 'c12/update'

function generateInitialConfig(featureKey, featureConfig) {
  let configContent = `export default defineNuxtConfig({`

  // add hub config if featureKey exists
  if (featureKey) {
    configContent += `
  hub: {
    ${featureKey}: true
  }`
  }

  if (featureConfig.nitroExperimental) {
    // add comma if we already have hub config
    configContent += featureKey ? `,` : ``
    configContent += `
  nitro: {
    experimental: {`

    Object.entries(featureConfig.nitroExperimental).forEach(([feature, value], index, array) => {
      configContent += `
      ${feature}: ${value}`
      // add comma if it's not the last entry
      if (index < array.length - 1) {
        configContent += ','
      }
    })

    configContent += `
    }
  }`
  }

  configContent += `
})`

  return configContent
}

function applyAdditionalConfig(config, featureConfig) {
  if (featureConfig.nitroExperimental) {
    config.nitro = config.nitro || {}
    config.nitro.experimental = config.nitro.experimental || {}

    Object.entries(featureConfig.nitroExperimental).forEach(([feature, value]) => {
      config.nitro.experimental[feature] = value
    })
  }
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

    // check if feature is enabled
    if (isFeatureEnabled(nuxtConfig, featureConfig)) {
      consola.info(`NuxtHub ${colors.cyan(feature)} feature is already enabled in this project.`)
    } else {

      if (requiresConfig) {
        consola.warn(`The ${colors.cyan(feature)} feature requires additional configuration and cannot be enabled with just a flag.`)
        consola.info(`Please refer to the documentation for configuration details: ${colors.underline(featureConfig.docs)}`)

        // managing exit codes
        return 1
      }

      try {
        let configCreated = false
        const { created } = await updateConfig({
          cwd,
          configFile: 'nuxt.config',

          // if the config file doesn't exist, create it
          onCreate: () => {
            configCreated = true
            return generateInitialConfig(featureKey, featureConfig)
          },

          onUpdate: (config) => {
            if (configCreated) {
              if (featureKey) {
                config.hub = config.hub || {}
                config.hub[featureKey] = true
              }

              applyAdditionalConfig(config, featureConfig)
              return
            }

            if (isFeatureEnabled(config, featureConfig)) {
              consola.info(`NuxtHub ${colors.cyan(feature)} feature is already enabled in this project.`)
              return false
            }

            if (featureKey) {
              config.hub = config.hub || {}
              config.hub[featureKey] = true
            }

            applyAdditionalConfig(config, featureConfig)
          }
        })

        if (created) {
          consola.success(`Created new Nuxt config with ${colors.cyan(feature)} feature enabled.`)
        } else {
          consola.success(`NuxtHub ${colors.cyan(feature)} feature has been enabled in your project.`)
        }
      } catch (error) {
        consola.error(`Failed to enable ${colors.cyan(feature)}: ${error.message}`)
        return 1
      }
    }

    const docsUrl = featureConfig.docs

    if (!requiresConfig || !isFeatureEnabled(nuxtConfig, featureConfig)) {
      consola.info(`Learn more about the ${colors.cyan(feature)} feature at: ${colors.underline(docsUrl)}`)
    }

    return 0
  },
})
