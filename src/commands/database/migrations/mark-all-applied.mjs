import ora from 'ora'
import { defineCommand, runCommand } from 'citty'
import { consola } from 'consola'
import { colors } from 'consola/utils'
import { isCancel, confirm } from '@clack/prompts'
import { fetchUser, fetchProject, projectPath, getProjectEnv, getMigrationFiles, useDatabaseQuery, createMigrationsTable, createMigrationsTableQuery } from '../../../utils/index.mjs'
import link from '../../link.mjs'
import login from '../../login.mjs'
import { $fetch } from 'ofetch'

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
    nuxtPort: {
      type: 'number',
      description: 'The port of Nuxt development server.',
      default: 3000
    },
    nuxtHostname: {
      type: 'string',
      description: 'The hostname of Nuxt development server.',
      default: 'localhost'
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

    const shouldApply = await confirm({
      message: `Do you want to mark ${colors.blue(total)} migration${total > 1 ? 's' : ''} as applied on ${args.local ? colors.blue('local') : args.production ? colors.green('production') : colors.yellow('preview')}?`,
      initialValue: true
    })
    if (!shouldApply || isCancel(shouldApply)) {
      return
    }

    // self hosted
    if (args.local && process.env.NUXT_HUB_PROJECT_SECRET_KEY && process.env.NUXT_HUB_PROJECT_URL) {
      consola.info(`Using \`${process.env.NUXT_HUB_PROJECT_URL}\` to apply migrations.`)
      const spinner = ora(`Marking ${colors.blue(total)} migration${total > 1 ? 's' : ''} as applied on ${colors.blue('local')}...`).start()

      try {
        const options = { url: process.env.NUXT_HUB_PROJECT_URL, token: process.env.NUXT_HUB_PROJECT_SECRET_KEY }
        await useLocalDatabaseQuery({ ...options, query: createMigrationsTableQuery })
        await useLocalDatabaseQuery({ ...options, query, params })
      } catch (error) {
        spinner.fail(`Could not mark all migrations as applied on ${colors.blue('local')}.`)
        if (error) consola.error(error.response?._data?.message || error)
        process.exit(1)
      }

      spinner.succeed(`Marked ${colors.blue(total)} migration${total > 1 ? 's' : ''} as applied on ${colors.blue('local')}.`)
      return process.exit(0)
    }

    // local
    if (args.local) {
      const spinner = ora(`Marking ${colors.blue(total)} migration${total > 1 ? 's' : ''} as applied on ${colors.blue('local')}...`).start()

      try {
        const options = { hostname: args.nuxtHostname, port: args.nuxtPort }
        await useLocalDatabaseQuery({ ...options, query: createMigrationsTableQuery })
        await useLocalDatabaseQuery({ ...options, query, params })
      } catch (error) {
        spinner.fail(`Could not mark all migrations as applied on ${colors.blue('local')}.`)
        if (error) consola.error(error.response?._data?.message || error)
        process.exit(1)
      }

      spinner.succeed(`Marked ${colors.blue(total)} migration${total > 1 ? 's' : ''} as applied on ${colors.blue('local')}.`)
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
      consola.warn(`${colors.blue(projectPath())} is not linked to a NuxtHub project.`)
      await runCommand(link, {})
      project = await fetchProject()
      if (!project) {
        return console.error('Could not fetch the project, please try again.')
      }
    }

    if (args.production || args.preview) {
      // Get the environment based on branch
      const env = getProjectEnv(project, args)
      const envColored = env === 'production' ? colors.green(env) : colors.yellow(env)
      const url = (env === 'production' ? project.url : project.previewUrl)
      if (!url) {
        consola.info(`Project ${colors.blue(project.slug)} does not have a ${envColored} deployment, please run \`nuxthub deploy --${env}\`.`)
        return
      }
      consola.info(`Using \`${url}\` to apply migrations.`)

      const spinner = ora(`Marking ${colors.blue(total)} migration${total > 1 ? 's' : ''} as applied on ${envColored} for ${colors.blue(project.slug)}...`).start()

      await createMigrationsTable(env)
      await useDatabaseQuery(env, query, params).catch((error) => {
        spinner.fail(`Could not mark all migrations as applied on ${envColored} for ${colors.blue(project.slug)}.`)
        if (error) consola.error(error)
        process.exit(1)
      })

      spinner.succeed(`Marked ${colors.blue(total)} migration${total > 1 ? 's' : ''} as applied on ${envColored} for ${colors.blue(project.slug)}.`)
    }
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

export const useLocalDatabaseQuery = async ({ url, hostname, port, token, query, params }) => {
  const fullUrl = url || `http://${hostname}:${port}`
  return await $fetch(`${fullUrl}/api/_hub/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: { query, params }
  }).catch((error) => {
    if (error.message.includes('fetch failed')) {
      consola.error(`Could not connect to \`http://${hostname}:${port}/api/_hub/database/query\`, please make sure to run the Nuxt development server with \`npx nuxt dev\`.`)
    } else {
      consola.error(error.data?.message || error)
    }
    process.exit(1)
  })
}
