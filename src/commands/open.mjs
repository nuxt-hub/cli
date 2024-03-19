import { consola } from 'consola'
import { colors } from 'consola/utils'
import { isCancel, confirm } from '@clack/prompts'
import { defineCommand, runCommand } from 'citty'
import { fetchUser, projectPath, fetchProject, gitInfo } from '../utils/index.mjs'
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
        return console.log('project is null')
      }
    }
    // Get the environment based on branch
    let env = 'production'
    if (args.preview) {
      env = 'preview'
    } else if (!args.production && !args.preview) {
      const git = gitInfo()
      // Guess the env based on the branch
      env = (git.branch === project.productionBranch) ? 'production' : 'preview'
    }
    const url = (env === 'production' ? project.url : project.previewUrl)

    if (!url) {
      consola.info(`Project \`${project.slug}\` does not have a \`${env}\` URL, please run \`nuxthub deploy --${env}\`.`)
      return
    }

    open(url)

    consola.success(`Project \`${url}\` opened in the browser.`)
  },
})
