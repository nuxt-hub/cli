import { consola } from 'consola'
import { colors } from 'consola/utils'
import { defineCommand, runCommand } from 'citty'
import { fetchUser, projectPath, fetchProject, NUXT_HUB_URL } from '../utils/index.mjs'
import { joinURL } from 'ufo'
import open from 'open'
import login from './login.mjs'
import link from './link.mjs'

export default defineCommand({
  meta: {
    name: 'open',
    description: 'Open in browser the NuxtHub URL for a linked project.',
  },
  async run() {
    let user = await fetchUser()
    if (!user) {
      consola.info('Please login to open a project in your browser.')
      await runCommand(login, {})
      user = await fetchUser()
    }
    let project = await fetchProject()
    if (!project) {
      consola.warn(`${colors.blue(projectPath())} is not linked to any NuxtHub project.`)

      await runCommand(link, {})
      project = await fetchProject()
      if (!project) {
        return console.error('Could not fetch the project, please try again.')
      }
    }

    const url = joinURL(NUXT_HUB_URL, project.teamSlug, project.slug)
    open(url)

    consola.success(`\`${url}\` opened in the browser.`)
  },
})
