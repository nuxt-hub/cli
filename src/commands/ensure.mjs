import { consola } from 'consola'
import { defineCommand } from 'citty'
import { getNuxtConfig } from '../utils/index.mjs'
import { execa } from 'execa'
import { resolve } from 'pathe'

export default defineCommand({
  meta: {
    name: 'ensure',
    description: 'Ensure the NuxtHub Core module is installed and registered in the project.',
  },
  args: {
    cwd: {
      type: 'positional',
      description: 'The directory of the application to ensure the NuxtHub Core module is installed and registered.',
      required: false,
      default: '.'
    },
  },
  async run({ args }) {
    const cmdCwd = process.cwd()
    const cwd = resolve(cmdCwd, args.cwd)

    // Load Nuxt config
    const nuxtConfig = await getNuxtConfig(cwd)
    nuxtConfig.modules = nuxtConfig.modules || []

    if (!nuxtConfig.modules.includes('@nuxthub/core')) {
      consola.info('@nuxthub/core module is not installed, installing...')
      await execa('npx', ['nuxi@latest', 'module', 'add', 'hub'], { cwd, stdio: 'inherit' })
    }

    consola.success('NuxtHub Core module is installed and registered in the project.')
  },
})
