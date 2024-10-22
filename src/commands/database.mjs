import ora from 'ora';
import { consola } from 'consola'
import { colors } from 'consola/utils';
import { isCancel, confirm } from '@clack/prompts'
import { defineCommand, runCommand } from 'citty'
import { useMigrationsStorage, getMigrationFiles, getNextMigrationNumber, getRemoteMigrations } from '../utils/database.mjs'
import { fetchUser, projectPath, fetchProject, getProjectEnv } from '../utils/index.mjs'
import link from './link.mjs';
import login from './login.mjs';

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
      .replace(/[^a-zA-Z0-9\s\n-]/g, '') // remove special characters except spaces, newlines and dashes
      .replace(/[\s\n]+/g, '-') // replace spaces and newlines with dashes
      .replace(/^-+/, '') // remove leading and trailing dashes
      .replace(/-+/g, '-') // replace multiple dashes with a single dash
      || 'migration'
    const migrationName = `${nextMigrationNumber}_${name}.sql`
    await useMigrationsStorage().set(migrationName, `-- Migration number: ${nextMigrationNumber} \t ${new Date().toISOString()}\n`)

    consola.success(`Created migration file \`server/migrations/${migrationName}\``)
  }
});

const listMigrations = defineCommand({
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

    const spinner = ora(`Retrieving migrations on ${envColored} for ${colors.blue(project.slug)}...`).start()

    const remoteMigrations = await getRemoteMigrations(env).catch((error) => {
      spinner.fail(`Could not retrieve migrations on ${envColored} for ${colors.blue(project.slug)}.`)
      if (error) consola.error(error)
    })
    spinner.stop()
    if (!remoteMigrations) process.exit(1)
    if (!remoteMigrations.length) consola.warn(`No applied migrations on ${envColored} for ${colors.blue(project.slug)}.`)

    const localMigrations = (await getMigrationFiles()).map(fileName => fileName.replace('.sql', ''))
    const pendingMigrations = localMigrations.filter(localName => !remoteMigrations.find(({ name }) => name === localName))
    const formattedPendingMigrations = pendingMigrations.map(fileName => ({ id: null, name: fileName, applied_at: null }))
    const migrations = remoteMigrations.concat(formattedPendingMigrations)

    if (!localMigrations.length) {
      consola.warn('No local migration files found.')
    }

    for (const { name, applied_at } of migrations) {
      const appliedAt = applied_at ? new Date(applied_at).toLocaleString() : 'Pending'
      const color = applied_at ? colors.green : colors.yellow
      consola.log(`${color(applied_at ? '✅' : '🕒')} ${name} ${colors.gray(appliedAt)}`)
    }

    process.exit(0)
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
