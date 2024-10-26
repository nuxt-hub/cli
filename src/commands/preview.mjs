import { consola } from 'consola'
import { defineCommand } from 'citty'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { join, relative } from 'pathe'
import { execa } from 'execa'
import { existsSync } from 'node:fs'
import { loadJsonFile } from 'load-json-file'
import { generateWrangler } from '../utils/index.mjs'

export default defineCommand({
  meta: {
    name: 'preview',
    description: 'Preview your project locally (using `wrangler pages dev`).',
  },
  args: {},
  async run() {
    const distDir = join(process.cwd(), 'dist')
    // Read the dist/hub.config.json file
    const hubConfig = await loadJsonFile(join(distDir, 'hub.config.json')).catch(() => null)
    if (!existsSync(distDir) || !hubConfig) {
      consola.error(`Production build not found, please run \`npx nuxt build\``)
      process.exit(1)
    }

    // Add .wrangler to .gitignore
    const gitignorePath = join(process.cwd(), '.gitignore')
    const gitignore = await readFile(gitignorePath, 'utf-8').catch(() => '')
    if (gitignore && !gitignore.includes('.wrangler')) {
      await writeFile(gitignorePath, `${gitignore ? gitignore + '\n' : gitignore}.wrangler`, 'utf-8')
    }

    const fileSideEffects = []
    // Wrangler does not support .env, only a .dev.vars
    // see https://developers.cloudflare.com/pages/functions/bindings/#interact-with-your-secrets-locally
    const envPath = join(process.cwd(), '.env')
    const devVarsPath = join(distDir, '.dev.vars')
    if (existsSync(envPath)) {
      consola.info(`Copying \`.env\` to \`${relative(process.cwd(), devVarsPath)}\`...`)
      const envVars = await readFile(envPath, 'utf-8').catch(() => '')
      await writeFile(devVarsPath, envVars, 'utf-8')
      fileSideEffects.push(devVarsPath)
    }

    const wrangler = generateWrangler(hubConfig)
    const wranglerPath = join(distDir, 'wrangler.toml')
    consola.info(`Generating \`${relative(process.cwd(), wranglerPath)}\`...`)
    fileSideEffects.push(wranglerPath)
    await writeFile(wranglerPath, wrangler)
    const options = { stdin: 'inherit', stdout: 'inherit', cwd: distDir, preferLocal: true, localDir: process.cwd() }
    if (hubConfig.database && existsSync(join(distDir, 'database/migrations'))) {
      consola.info('Applying migrations...')
      await execa({ ...options, stdin: 'ignore' })`wrangler d1 migrations apply default --local`
      .catch((err) => {
        if (err.code === 'ENOENT') {
          consola.error('`wrangler` is not installed, please make sure that you installed it with `npx nypm i -D wrangler`')
          process.exit(1)
        }
        throw err
      })
    }
    consola.info('Starting `wrangler pages dev` command...')
    await execa(options)`wrangler pages dev .`
      .catch((err) => {
        if (err.code === 'ENOENT') {
          consola.error('`wrangler` is not installed, please make sure that you installed it with `npx nypm i -D wrangler`')
          process.exit(1)
        }
        throw err
      })
    consola.info('Cleaning up generated files for preview...')
    await Promise.all(fileSideEffects.map(unlink))
  },
})
