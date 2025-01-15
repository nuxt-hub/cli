import { consola } from 'consola'
import { colors } from 'consola/utils'
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
  async run({ args }) {
    let user = await fetchUser()
    if (!user) {
      consola.info('Please login to open a project in your browser.')
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
    // Get the environment based on branch
    const env = getProjectEnv(project, args)
    const envColored = env === 'production' ? colors.greenBright(env) : colors.yellowBright(env)
    const url = (env === 'production' ? project.url : project.previewUrl)
    consola.info(`Opening ${envColored} URL of ${colors.blueBright(project.slug)} in the browser...`)

    if (!url) {
      consola.info(`Project ${colors.blueBright(project.slug)} does not have a ${envColored} URL, please run \`nuxthub deploy --${env}\`.`)
      return
    }

    open(url)

    consola.success(`\`${url}\` opened in the browser.`)
  },
})
