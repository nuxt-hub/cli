import { consola } from 'consola'
import { colors } from 'consola/utils'
import { isCancel, confirm } from '@clack/prompts'
import { defineCommand, runCommand } from 'citty'
import { fetchUser, projectPath, fetchProject } from '../utils/index.mjs'
import open from 'open'
import login from './login.mjs'
import link from './link.mjs'

export default defineCommand({
  meta: {
    name: 'open',
    description: 'Open in browser the project URL linked to the current directory.',
  },
  async setup() {
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

    if (!project.url) {
      consola.info(`Project \`${project.slug}\` does not have a URL, please run \`nuxthub deploy\`.`)
      return
    }

    open(project.url)

    consola.success(`Project \`${project.url}\` opened in the browser.`)
  },
})
