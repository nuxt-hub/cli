import ora from 'ora'
import { consola } from 'consola'
import { colors } from 'consola/utils'
import { isCancel, confirm } from '@clack/prompts'
import { defineCommand, runCommand } from 'citty'
import { joinURL } from 'ufo'
import { join } from 'pathe'
import { createStorage } from 'unstorage'
import fsDriver from 'unstorage/drivers/fs'
import { execa } from 'execa'
import { existsSync } from 'fs'
import mime from 'mime'
import prettyBytes from 'pretty-bytes'
import { loadNuxtConfig } from '@nuxt/kit'
import { $api, fetchUser, selectTeam, selectProject, projectPath, withTilde, fetchProject, linkProject, hashFile, gitInfo, pollDns, pollHttp, MAX_ASSET_SIZE } from '../utils/index.mjs'
import login from './login.mjs'

export default defineCommand({
  meta: {
    name: 'deploy',
    description: 'Deploy your project to NuxtHub.',
  },
  args: {
    build: {
      type: 'boolean',
      description: 'Build the project before deploying.',
      default: true
    },
    production: {
      type: 'boolean',
      description: 'Force the current deployment as production.',
      default: false
    },
    preview: {
      type: 'boolean',
      description: 'Force the current deployment as preview.',
      default: false
    }
  },
  async setup({ args }) {
    let user = await fetchUser()
    if (!user) {
      consola.info('Please login to deploy your project.')
      await runCommand(login, {})
      user = await fetchUser()
    }
    let linkedProject = await fetchProject()
    // If the project is not linked
    if (!linkedProject) {
      const shouldDeploy = await confirm({
        message: `Deploy ${colors.blue(projectPath())} to NuxtHub?`
      })
      if (!shouldDeploy || isCancel(shouldDeploy)) {
        return consola.log('Cancelled.')
      }

      const team = await selectTeam()
      if (!team) return

      const project = await selectProject(team)
      if (!project) return consola.log('Cancelled.')
      await linkProject(project)
      // Use correct project format
      linkedProject = await fetchProject()
    }
    const git = gitInfo()
    if (args.production) {
      git.branch = linkedProject.productionBranch || 'main'
    } else if (args.preview) {
      // Set branch as "preview", except if someone decided to set the production branch as "preview"
      git.branch = linkedProject.productionBranch === 'preview' ? 'force_preview' : 'preview'
    }
    // Default to main branch
    git.branch = git.branch || 'main'
    const deployEnv = git.branch === linkedProject.productionBranch ? 'production' : 'preview'
    const deployEnvColored = deployEnv === 'production' ? colors.green(deployEnv) : colors.yellow(deployEnv)
    consola.success(`Connected to ${colors.blue(linkedProject.teamSlug)} team.`)
    consola.success(`Linked to ${colors.blue(linkedProject.slug)} project.`)
    consola.info(`Preparing deployment for ${deployEnvColored}.`)

    const nuxtConfig = await loadNuxtConfig()
    if (!nuxtConfig) {
      consola.error('Could not load Nuxt config.')
      process.exit(1)
    }

    if (args.build) {
      consola.info('Building the Nuxt project...')
      await execa('./node_modules/.bin/nuxi', ['build', '--preset=cloudflare-pages'], { stdio: 'inherit' })
        .catch((err) => {
          if (err.code === 'ENOENT') {
            consola.error('`nuxt` is not installed, please make sure that you are inside a Nuxt project.')
            process.exit(1)
          }
          throw err
        })
    }

    const distDir = join(process.cwd(), 'dist')
    if (!existsSync(distDir)) {
      consola.error(`${colors.cyan(withTilde(distDir))} directory not found, please make sure that you have built your project.`)
      process.exit(1)
    }
    const srcStorage = createStorage({
      driver: fsDriver({ base: distDir }),
    })
    const fileKeys = await srcStorage.getKeys()
    const files = await Promise.all(fileKeys.map(async (fileKey) => {
      const data = await srcStorage.getItemRaw(fileKey)
      const filepath = fileKey.replace(/:/g, '/')
      const fileContentBase64 = data.toString('base64')

      if (data.size > MAX_ASSET_SIZE) {
        console.error(`NuxtHub deploy only supports files up to ${prettyBytes(MAX_ASSET_SIZE, { binary: true })} in size\n${withTilde(filepath)} is ${prettyBytes(data.size, { binary: true })} in size`)
        process.exit(1)
      }

      return {
        path: joinURL('/', filepath),
        key: hashFile(filepath, fileContentBase64),
        value: fileContentBase64,
        base64: true,
        metadata: {
          contentType: mime.getType(filepath) || 'application/octet-stream'
        }
      }
    }))
    // TODO: make a tar with nanotar by the amazing Pooya Parsa (@pi0)

    const spinner = ora(`Deploying ${colors.blue(linkedProject.slug)} to ${deployEnvColored}...`).start()
    const deployment = await $api(`/teams/${linkedProject.teamSlug}/projects/${linkedProject.slug}/deploy`, {
      method: 'POST',
      body: {
        config: nuxtConfig.hub,
        git,
        files
      }
    })
    spinner.succeed(`Deployed ${colors.blue(linkedProject.slug)} to ${deployEnvColored}...`)
    // Check DNS & ready url for first deployment
    if (deployment.isFirstDeploy) {
      await pollDns(deployment.url)
    }
    await pollHttp(deployment.primaryUrl || deployment.url)
    process.exit(0)
  },
})
