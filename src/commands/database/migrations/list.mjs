import ora from 'ora'
import { defineCommand, runCommand } from 'citty'
import { consola } from 'consola'
import { colors } from 'consola/utils'
import { isCancel, confirm } from '@clack/prompts'
import { fetchUser, fetchProject, projectPath, getProjectEnv, getRemoteMigrations, getMigrationFiles } from '../../../utils/index.mjs'
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
