import { consola } from 'consola'
import { defineCommand } from 'citty'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'pathe'
import { execa } from 'execa'
import { existsSync } from 'fs'
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

    consola.info('Generating wrangler.toml...')
    const wrangler = generateWrangler(hubConfig)
    const wranglerPath = join(distDir, 'wrangler.toml')
    await writeFile(wranglerPath, wrangler)
    consola.info('Starting `wrangler pages dev` command...')
    const options = { stdio: 'inherit', cwd: distDir, preferLocal: true, localDir: process.cwd() }
    await execa(options)`wrangler pages dev .`
      .catch((err) => {
        if (err.code === 'ENOENT') {
          consola.error('`wrangler` is not installed, please make sure that you installed it with `npx nypm i -D wrangler`')
          process.exit(1)
        }
        throw err
      })
    consola.info('Deleting generated wrangler.toml for preview...')
    await unlink(wranglerPath)
  },
})
