import { consola } from 'consola'
import { colors } from 'consola/utils'
import { isCancel, confirm } from '@clack/prompts'
import { defineCommand, runCommand } from 'citty'
import { fetchUser, projectPath, fetchProject, unlinkProject } from '../utils/index.mjs'
import login from './login.mjs'

export default defineCommand({
  meta: {
    name: 'link',
    description: 'Unlink a local directory from a NuxtHub project.',
  },
  async run() {
    let user = await fetchUser()
    if (!user) {
      consola.info('Please login to unlink your project.')
      await runCommand(login, {})
      user = await fetchUser()
    }
    let project = await fetchProject()
    if (!project) {
      consola.warn('This directory is not linked to any NuxtHub project.')
      return
    }
    const shouldUnlink = await confirm({
      message: `Do you want to unlink ${colors.blueBright(projectPath())} from NuxtHub project ${colors.blueBright(project.slug)}?`,
      initialValue: false
    })
    if (!shouldUnlink || isCancel(shouldUnlink)) {
      return consola.log('Cancelled.')
    }

    await unlinkProject()

    consola.success(`Project ${colors.blueBright(project.slug)} unlinked.`)
  },
})
