import { consola } from 'consola'
import { defineCommand, runCommand } from 'citty'
import { useMigrationsStorage, getMigrationFiles, getNextMigrationNumber } from '../utils/database.mjs'
import { getProjectEnv } from '../utils/git.mjs';
import { colors } from 'consola/utils';
import { $api, fetchProject, fetchUser } from '../utils/data.mjs';
import { projectPath } from '../utils/config.mjs';
import { isCancel } from '@clack/prompts';
import link from './link.mjs';
import login from './login.mjs';
import ora from 'ora';
import { joinURL } from 'ufo'

const createMigration = defineCommand({
  meta: {
    name: 'create',
    description: 'Create a new blank database migration file.',
  },
  args: {
    name: {
      type: 'positional',
      description: 'Name of the migration.',
      required: true
    },
  },
  async run({ args }) {
    const nextMigrationNumber = await getNextMigrationNumber()
    const name = args.name
      .trim()
      .toLowerCase()
      .replace(/[^a-zA-Z0-9\s\n]/g, '') // remove special characters except spaces and newlines
      .replace(/[\s\n]+/g, '-') // replace spaces and newlines with dashes
      .replace(/^-+/, '') // remove leading and trailing dashes
      || 'migration'
    const migrationName = `${nextMigrationNumber}_${name}.sql`
    await useMigrationsStorage().set(migrationName, `-- Migration number: ${nextMigrationNumber} \t ${new Date().toISOString()}\n`)

    consola.success(`Created migration file \`server/migrations/${migrationName}\``)
  }
});

const listMigrations = defineCommand({
  meta: {
    name: 'list',
    description: 'List migrations which are pending and which have been applied.',
  },
  args: {
    production: {
      type: 'boolean',
      description: 'List applied and unapplied migrations on the production environment.',
      default: false
    },
    preview: {
      type: 'boolean',
      description: 'List applied and unapplied migrations on the preview environment.',
      default: false
    }
  },
  async run({ args }) {
    let user = await fetchUser()
    if (!user) {
      consola.info('Please login to open a project in your browser.')
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

    // Get the environment based on branch
    const env = getProjectEnv(project, args)
    const envColored = env === 'production' ? colors.green(env) : colors.yellow(env)
    const url = (env === 'production' ? project.url : project.previewUrl)
    if (!url) {
      consola.info(`Project ${colors.blue(project.slug)} does not have a ${envColored} URL, please run \`nuxthub deploy --${env}\`.`)
      return
    }

    // Get local migrations files
    const migrationFiles = await getMigrationFiles()
    if (!migrationFiles.length) {
      consola.warn('No local migration files found.')
    }

    // Loading while querying remote for migrations
    const spinner = ora(`Retrieving migrations on ${envColored} for ${colors.blue(project.slug)}...`).start()
    setTimeout(() => spinner.color = 'magenta', 2500)
    setTimeout(() => spinner.color = 'blue', 5000)
    setTimeout(() => spinner.color = 'yellow', 7500)

    /**
     * @type {Array<[number, string, number]>}
     */
    const remoteMigrations = await $api(`database/query`, {
      baseURL: joinURL(url, '/api/_hub'),
      headers: {
        Authorization: `Bearer ${project.userProjectToken}`
      },
      method: 'POST',
      body: {
        query: 'select "id", "name", "applied_at" from "d1_migrations" order by "d1_migrations"."id"',
        mode: 'raw'
      }
    }).catch((error) => {
      if (error.response?.status === 500 && error.response?._data?.message.includes('no such table')) {
        return []
      }

      spinner.fail(`Could not retrieve migrations on ${envColored} for ${colors.blue(project.slug)}.`)
      if (error.response?.status === 422) {
        console.error(`NuxtHub database is not enabled on ${env}. Deploy a new version with hub.database enabled and try again.`, error)
      }
      return null
    })

    spinner.stop()
    if (!remoteMigrations) return // stop if error
    if (!remoteMigrations.length) consola.warn(`No applied migrations on ${envColored} for ${colors.blue(project.slug)}.`)
    if (Array.isArray(remoteMigrations[0])) remoteMigrations.shift() // remove column names

    const localMigrations = migrationFiles.map(fileName => fileName.replace('.sql', ''))
    const unappliedMigrations = localMigrations.filter(localName => !remoteMigrations.find(([_id, name]) => name === localName))
    const formattedUnappliedMigrations = unappliedMigrations.map(fileName => [null, fileName, null])
    const allMigrations = remoteMigrations.concat(formattedUnappliedMigrations)

    for (const migration of allMigrations) {
      // eslint-disable-next-line no-unused-vars
      const [_id, name, applied_at] = migration
      const isApplied = !!applied_at
      const appliedAt = isApplied ? new Date(applied_at).toLocaleString() : 'Pending'
      const color = isApplied ? colors.green : colors.yellow
      consola.log(`${color(isApplied ? '✅' : '🕒')} ${name} ${colors.gray(appliedAt)}`)
    }
  }
})

const migrations = defineCommand({
  meta: {
    name: 'migrations',
    description: 'Database migrations commands.',
  },
  subCommands: [
    createMigration,
    listMigrations
  ]
});

export default defineCommand({
  meta: {
    name: 'database',
    description: 'Database management commands.',
  },
  subCommands: [
    migrations
  ]
});
