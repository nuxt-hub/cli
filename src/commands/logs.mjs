import { consola } from 'consola'
import { colors } from 'consola/utils'
import { onExit } from 'signal-exit'
import { setTimeout } from 'timers/promises'
import { defineCommand, runCommand } from 'citty'
import { isCancel, confirm } from '@clack/prompts'
import { fetchUser, projectPath, fetchProject } from '../utils/index.mjs'
import login from './login.mjs'
import { connectLogs, createLogs, deleteLogs, printFormattedLog } from '../utils/logs.mjs'
import link from './link.mjs'

export default defineCommand({
  meta: {
    name: 'logs',
    description: 'Display the logs of a deployment.',
  },
  args: {
    production: {
      type: 'boolean',
      description: 'Display the logs of the production deployment.',
      default: false
    },
    preview: {
      type: 'boolean',
      description: 'Display the logs of the preview deployment.',
      default: true
    }
  },
  async setup({ args }) {
    let user = await fetchUser()
    if (!user) {
      consola.info('Please login to deploy your project.')
      await runCommand(login, {})
      user = await fetchUser()
    }

    const env = args.production ? 'production' : 'preview'
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

    consola.start(`Connecting to ${env} deployment...`)

    const logs = await createLogs(project.slug, project.teamSlug, env)
    
    const socket = connectLogs(logs.url)

    const onCloseSocket = async () => {
      socket.terminate()
      await deleteLogs(project.slug, project.teamSlug, env, logs.id)
    }

    onExit(onCloseSocket)
    socket.on('close', onCloseSocket)
  
    socket.on('message', (data) => {
      printFormattedLog(data)
    })
  
    while (socket.readyState !== socket.OPEN) {
      switch (socket.readyState) {
        case socket.CONNECTING:
          await setTimeout(100)
          break
        case socket.CLOSING:
          await setTimeout(100)
          break
        case socket.CLOSED:
          throw new Error(
            'Connection to deployment closed unexpectedly.'
          )
      }
    }
    
    consola.success(`Connected to ${env} deployment waiting for logs...`)
  },
})
