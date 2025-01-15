import ora from 'ora'
import { defineCommand, runCommand } from 'citty'
import { consola } from 'consola'
import { colors } from 'consola/utils'
import { fetchUser, fetchProject, projectPath, getProjectEnv, fetchRemoteMigrations, getMigrationFiles } from '../../../utils/index.mjs'
import link from '../../link.mjs'
import login from '../../login.mjs'

export default defineCommand({
  meta: {
    name: 'list',
    description: 'List applied and pending migrations.',
  },
  args: {
    production: {
      type: 'boolean',
      description: 'List applied and pending migrations for the production environment.',
      default: false
    },
    preview: {
      type: 'boolean',
      description: 'List applied and pending migrations for the preview environment.',
      default: false
    },
    local: {
      type: 'boolean',
      description: 'List applied and pending migrations for the local development environment.',
      default: false
    },
    url: {
      type: 'string',
      description: 'The URL of the Nuxt server, defaults to `process.env.NUXT_HUB_PROJECT_URL` || `http://localhost:3000`',
    }
  },
  async run({ args }) {
    const localMigrations = (await getMigrationFiles()).map(fileName => fileName.replace('.sql', ''))
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
    let remoteMigrations = []

    // local or self hosted
    if (args.local) {
      const url = args.url || process.env.NUXT_HUB_PROJECT_URL || 'http://localhost:3000'
      const token = process.env.NUXT_HUB_PROJECT_SECRET_KEY // used for self-hosted projects
      const spinner = ora(`Retrieving migrations on ${colors.cyanBright(url)}...`).start()
      remoteMigrations = await fetchRemoteMigrations({ url, token }).catch((error) => {
        spinner.fail(`Could not retrieve migrations on ${colors.cyanBright(url)}.`)
        consola.error(error.message)
        process.exit(1)
      })
      spinner.succeed(`Found ${remoteMigrations.length} migration${remoteMigrations.length === 1 ? '' : 's'} on ${colors.cyanBright(url)}...`)
    } else {
      let user = await fetchUser()
      if (!user) {
          consola.info('Please login to list migrations.')
        await runCommand(login, {})
        user = await fetchUser()
      }

      let project = await fetchProject()
      if (!project) {
        consola.warn(`${colors.blueBright(projectPath())} is not linked to any NuxtHub project.`)

        await runCommand(link, {})
        project = await fetchProject()
        if (!project) {
          return console.error('Could not fetch the project, please try again.')
        }
      }
      consola.info(`Connected to project ${colors.blueBright(project.slug)}.`)

      // Get the environment based on branch
      const env = getProjectEnv(project, args)
      const envColored = env === 'production' ? colors.greenBright(env) : colors.yellowBright(env)
      const url = (env === 'production' ? project.url : project.previewUrl)
      if (!url) {
        consola.info(`Project ${colors.blueBright(project.slug)} does not have a ${envColored} URL, please run \`nuxthub deploy --${env}\`.`)
        return
      } else {
        consola.info(`Using \`${url}\` to retrieve migrations.`)
      }

      const spinner = ora(`Retrieving migrations on ${envColored} for ${colors.blueBright(project.slug)}...`).start()
      remoteMigrations = await fetchRemoteMigrations({ env }).catch((error) => {
        spinner.fail(`Could not retrieve migrations on ${envColored} for ${colors.blueBright(project.slug)}.`)
        consola.error(error.message)
        process.exit(1)
      })
      spinner.succeed(`Found ${remoteMigrations.length} migration${remoteMigrations.length === 1 ? '' : 's'} on ${colors.blueBright(project.slug)}...`)
    }

    const pendingMigrations = localMigrations.filter(localName => !remoteMigrations.find(({ name }) => name === localName))
    const formattedPendingMigrations = pendingMigrations.map(fileName => ({ id: null, name: fileName, applied_at: null }))
    const migrations = remoteMigrations.concat(formattedPendingMigrations)

    for (const { name, applied_at } of migrations) {
      const appliedAt = applied_at ? new Date(applied_at).toLocaleString() : 'Pending'
      const color = applied_at ? colors.green : colors.yellow
      consola.log(`${color(applied_at ? '✅' : '🕒')} \`./server/database/migrations/${name}.sql\` ${colors.gray(appliedAt)}`)
    }

    process.exit(0)
  }
})
