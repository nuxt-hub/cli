import { consola } from 'consola'
import { colors } from 'consola/utils'
import { isCancel, confirm } from '@clack/prompts'
import { defineCommand, runCommand } from 'citty'
import { fetchUser, projectPath, fetchProject, getProjectEnv } from '../utils/index.mjs'
import open from 'open'
import login from './login.mjs'
import link from './link.mjs'

export default defineCommand({
  meta: {
    name: 'open',
    description: 'Open in browser the project\'s URL linked to the current directory.',
  },
  args: {
    production: {
      type: 'boolean',
      description: 'Open the production deployment.',
      default: false
    },
    preview: {
      type: 'boolean',
      description: 'Open the latest preview deployment.',
      default: false
    }
  },
  async setup({ args }) {
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
    consola.info(`Opening ${envColored} URL of ${colors.blue(project.slug)} in the browser...`)

    if (!url) {
      consola.info(`Project ${colors.blue(project.slug)} does not have a ${envColored} URL, please run \`nuxthub deploy --${env}\`.`)
      return
    }

    open(url)

    consola.success(`\`${url}\` opened in the browser.`)
  },
})
