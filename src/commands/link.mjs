import { consola } from 'consola'
import { colors } from 'consola/utils'
import { isCancel, confirm } from '@clack/prompts'
import { defineCommand, runCommand } from 'citty'
import { fetchUser, selectTeam, selectProject, projectPath, linkProject, fetchProject } from '../utils/index.mjs'
import login from './login.mjs'

export default defineCommand({
  meta: {
    name: 'link',
    description: 'Link a local directory to a NuxtHub project.',
  },
  async run() {
    let user = await fetchUser()
    if (!user) {
      consola.info('Please login to link your project.')
      await runCommand(login, {})
      user = await fetchUser()
    }
    let project = await fetchProject()
    if (project) {
      consola.warn(`This directory is already linked to the ${colors.blueBright(project.slug)} project.`)

      const linkAnyway = await confirm({
        message: `Do you want to link ${colors.blueBright(projectPath())} to another project?`,
        initialValue: false
      })
      if (!linkAnyway || isCancel(linkAnyway)) {
        return
      }
    } else {
      const shouldLink = await confirm({
        message: `Link ${colors.blueBright(projectPath())} to NuxtHub?`
      })
      if (!shouldLink || isCancel(shouldLink)) {
        return consola.log('Cancelled.')
      }
    }

    const team = await selectTeam()
    if (!team) return

    project = await selectProject(team)
    if (!project) return consola.log('Cancelled.')

    await linkProject(project)

    consola.success(`Project ${colors.blueBright(project.slug)} linked.`)
  },
})
