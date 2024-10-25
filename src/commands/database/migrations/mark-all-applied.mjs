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
    const query = generateQuery(localMigrations)

    // set local as default if no env is provided
    if (!args.production && !args.preview && !args.local) {
      args.local = true
    }

    // local & self hosted
    if (args.local && process.env.NUXT_HUB_PROJECT_SECRET_KEY) {
      // call POST localhost:localPort/api/_hub/database/batch with project.userProjectToken
      consola.success(`Marked all migrations as applied on \`local\`.`)
      return process.exit(0)
    }

    // remote/local & linked project
    let user = await fetchUser()
    if (!user) {
      consola.info('Please login to mark migrations as applied.')
      await runCommand(login, {})
      user = await fetchUser()
    }

    let project = await fetchProject()
    if (!project) {
      consola.warn(`${colors.blue(projectPath())} is not linked to any NuxtHub project.`)

      const shouldLink = await confirm({
        message: 'Do you want to link it to a project?',
        initialValue: false
      })
      if (!shouldLink || isCancel(shouldLink)) {
        return
      }
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

      const spinner = ora(`Marking all migrations as applied on ${envColored} for ${colors.blue(project.slug)}...`).start()

      await createMigrationsTable(env)
      await useDatabaseQuery(env, query).catch((error) => {
        spinner.fail(`Could not mark all migrations as applied on ${envColored} for ${colors.blue(project.slug)}.`)
        if (error) consola.error(error)
        process.exit(1)
      })

      spinner.succeed(`Marked all migrations as applied on ${envColored} for ${colors.blue(project.slug)}.`)
    }

    if (args.local) {
      const spinner = ora(`Marking all migrations as applied on ${colors.blue('local')}...`).start()

      try {
        const options = { hostname: args.nuxtHostname, port: args.nuxtPort, userProjectToken: project.userProjectToken }
        await useLocalDatabaseQuery({ ...options, query: createMigrationsTableQuery })
        await useLocalDatabaseQuery({ ...options, query })
      } catch (error) {
        spinner.fail(`Could not mark all migrations as applied on ${colors.blue('local')}.`)
        if (error) consola.error(error.response?._data?.message || error)
        process.exit(1)
      }

      spinner.succeed(`Marked all migrations as applied on ${colors.blue('local')}.`)
    }
  }
});

function generateQuery(migrations) {
  return `INSERT OR IGNORE INTO hub_migrations (name) values ${migrations.map((name, i, m) => `('${name}')${i === m.length - 1 ? ';' : ', '}`).join('')}`
}

export const useLocalDatabaseQuery = async ({hostname, port, userProjectToken, query}) => {
  return await $fetch(`http://${hostname}:${port}/api/_hub/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userProjectToken}`
    },
    body: { query }
  })
}
