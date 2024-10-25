import { consola } from 'consola'
import { colors } from 'consola/utils'
import ora from 'ora'
import { onExit } from 'signal-exit'
import { setTimeout } from 'timers/promises'
import { defineCommand, runCommand } from 'citty'
import { fetchUser, projectPath, fetchProject, getProjectEnv, connectLogs, createLogs, deleteLogs, printFormattedLog } from '../utils/index.mjs'
import login from './login.mjs'
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
      description: 'Display the logs of the latest preview deployment.',
      default: false
    }
  },
  async run({ args }) {
    let user = await fetchUser()
    if (!user) {
      consola.info('Please login to deploy your project.')
      await runCommand(login, {})
      user = await fetchUser()
    }

    let project = await fetchProject()
    if (!project) {
      consola.warn(`${colors.blue(projectPath())} is not linked to any NuxtHub project.`)

      await runCommand(link, {})
      project = await fetchProject()
      if (!project) {
        return consola.error('Could not fetch the project, please try again.')
      }
    }
    const env = getProjectEnv(project, args)
    const envColored = env === 'production' ? colors.green(env) : colors.yellow(env)
    const url = (env === 'production' ? project.url : project.previewUrl)
    if (!url) {
      consola.info(`No deployment found for ${envColored} environment.`)
      return consola.info(`Please run \`nuxthub deploy --${env}\` to deploy your project.`)
    }
    consola.success(`Linked to ${colors.blue(project.slug)} project available at \`${url}\``)

    const spinner = ora(`Connecting to ${envColored} deployment...`).start()

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
          consola.error('Connection to deployment closed unexpectedly.')
          await onCloseSocket()
          process.exit(1)
      }
    }

    spinner.succeed(`Connected to ${envColored} deployment waiting for logs...`)
  },
})
