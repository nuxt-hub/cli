import ora from 'ora'
import { defineCommand, runCommand } from 'citty'
import { consola } from 'consola'
import { colors } from 'consola/utils'
import { isCancel, confirm } from '@clack/prompts'
import { fetchUser, fetchProject, projectPath, getProjectEnv, getMigrationFiles, queryDatabase, createMigrationsTable } from '../../../utils/index.mjs'
import link from '../../link.mjs'
import login from '../../login.mjs'

export default defineCommand({
  meta: {
    name: 'mark-all-applied',
    description: 'Marks all migration files as applied without running them.',
  },
  args: {
    production: {
      type: 'boolean',
      description: 'Mark all migrations as applied on the production environment.',
      default: false
    },
    preview: {
      type: 'boolean',
      description: 'Mark all migrations as applied on the production environment.',
      default: false
    },
    local: {
      type: 'boolean',
      description: 'Mark all migrations as applied on the local development environment.',
      default: false
    },
    url: {
      type: 'string',
      description: 'The URL of the Nuxt server, defaults to `process.env.NUXT_HUB_PROJECT_URL` || `http://localhost:3000`',
    }
  },
  async run({ args }) {
    const localMigrations = (await getMigrationFiles()).map(fileName => fileName.replace('.sql', ''))
    const { query, params } = generateQuery(localMigrations)
    const total = localMigrations.length

    if (total === 0) {
      consola.info('No migrations found in `./server/database/migrations`, please create one first.')
      return process.exit(0)
    }

    // set local as default if no env is provided
    if (!args.production && !args.preview && !args.local) {
      args.local = true
      consola.info('No environment provided, defaulting to `local`.')
    }

    // local or self hosted
    if (args.local) {
      const url = args.url || process.env.NUXT_HUB_PROJECT_URL || 'http://localhost:3000'
      const token = process.env.NUXT_HUB_PROJECT_SECRET_KEY // used for self-hosted projects

      const shouldApply = await confirm({
        message: `Do you want to mark ${colors.blueBright(total)} migration${total > 1 ? 's' : ''} as applied on ${colors.cyanBright(url)}?`,
        initialValue: true
      })
      if (!shouldApply || isCancel(shouldApply)) return
      const spinner = ora(`Marking ${colors.blueBright(total)} migration${total > 1 ? 's' : ''} as applied on ${colors.cyanBright(url)}...`).start()

      try {
        await createMigrationsTable({ url, token })
        await queryDatabase({ url, token, query, params })
      } catch (error) {
        spinner.fail(`Could not mark all migrations as applied on ${colors.cyanBright(url)}.`)
        if (error) consola.error(error.response?._data?.message || error)
        process.exit(1)
      }

      spinner.succeed(`Marked ${colors.blueBright(total)} migration${total > 1 ? 's' : ''} as applied on ${colors.cyanBright(url)}.`)
      return process.exit(0)
    }

    // production/preview with linked project
    let user = await fetchUser()
    if (!user) {
      consola.info('Please login to mark migrations as applied.')
      await runCommand(login, {})
      user = await fetchUser()
    }

    let project = await fetchProject()
    if (!project) {
      consola.warn(`${colors.blueBright(projectPath())} is not linked to a NuxtHub project.`)
      await runCommand(link, {})
      project = await fetchProject()
      if (!project) {
        return console.error('Could not fetch the project, please try again.')
      }
    }
    consola.info(`Connected to project ${colors.blueBright(project.slug)}.`)

    // Get the environment based on args or branch
    const env = getProjectEnv(project, args)
    const envColored = env === 'production' ? colors.greenBright(env) : colors.yellowBright(env)
    const url = (env === 'production' ? project.url : project.previewUrl)
    if (!url) {
      consola.info(`Project ${colors.blueBright(project.slug)} does not have a ${envColored} deployment, please run \`nuxthub deploy --${env}\`.`)
      return
    }
    consola.info(`Using \`${url}\` to apply migrations.`)
    const shouldApply = await confirm({
      message: `Do you want to mark ${colors.blueBright(total)} migration${total > 1 ? 's' : ''} as applied on ${envColored}?`,
      initialValue: true
    })
    if (!shouldApply || isCancel(shouldApply)) return

    const spinner = ora(`Marking ${colors.blueBright(total)} migration${total > 1 ? 's' : ''} as applied on ${envColored} for ${colors.blueBright(project.slug)}...`).start()

    await createMigrationsTable({ env })
    await queryDatabase({ env, query, params }).catch((error) => {
      spinner.fail(`Could not mark all migrations as applied on ${envColored} for ${colors.blueBright(project.slug)}.`)
      if (error) consola.error(error)
      process.exit(1)
    })

    spinner.succeed(`Marked ${colors.blueBright(total)} migration${total > 1 ? 's' : ''} as applied on ${envColored} for ${colors.blueBright(project.slug)}.`)
  }
});

/**
 * @param {string[]} migrations
 */
function generateQuery(migrations) {
  return {
    query: `INSERT OR IGNORE INTO _hub_migrations (name) values ${migrations.map((_, i, m) => `(?)${i === m.length - 1 ? ';' : ', '}`).join('')}`,
    params: migrations
  }
}
