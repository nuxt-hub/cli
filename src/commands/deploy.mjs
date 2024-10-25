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
import { setupDotenv } from 'c12'
import { $api, fetchUser, selectTeam, selectProject, projectPath, withTilde, fetchProject, linkProject, hashFile, gitInfo, getPackageJson, MAX_ASSET_SIZE } from '../utils/index.mjs'
import { createMigrationsTable, fetchRemoteMigrations, queryDatabase } from '../utils/database.mjs'
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
    },
    dotenv: {
      type: 'string',
      description: 'Point to another .env file to load, relative to the root directory.',
      default: ''
    }
  },
  async run({ args }) {
    const cwd = process.cwd()
    if (args.dotenv) {
      consola.info(`Loading env from \`${args.dotenv}\``)
      await setupDotenv({
        cwd,
        fileName: args.dotenv
      })
    }
    let user = await fetchUser()
    if (!user) {
      consola.info('Please login to deploy your project or set the `NUXT_HUB_USER_TOKEN` environment variable.')
      await runCommand(login, {})
      user = await fetchUser()
    }
    let linkedProject = await fetchProject()
    // If the project is not linked
    if (!linkedProject) {
      consola.info('No project is linked with the `NUXT_HUB_PROJECT_KEY` environment variable.')
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

    if (args.build) {
      consola.info('Building the Nuxt project...')
      const pkg = await getPackageJson()
      const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies)
      if (!deps['@nuxthub/core']) {
        consola.error('`@nuxthub/core` is not installed, make sure to install it with `npx nuxt module add hub`')
        process.exit(1)
      }
      const nuxiBuildArgs = []
      if (args.dotenv) {
        nuxiBuildArgs.push(`--dotenv=${args.dotenv}`)
      }
      await execa('./node_modules/.bin/nuxi', ['build', ...nuxiBuildArgs], { stdio: 'inherit' })
        .catch((err) => {
          if (err.code === 'ENOENT') {
            consola.error('`nuxt` is not installed, please make sure that you are inside a Nuxt project.')
            process.exit(1)
          }
          throw err
        })
    }

    const distDir = join(cwd, 'dist')
    if (!existsSync(distDir)) {
      consola.error(`${colors.cyan(withTilde(distDir))} directory not found, please make sure that you have built your project.`)
      process.exit(1)
    }
    const srcStorage = createStorage({
      driver: fsDriver({
        base: distDir,
        ignore: ['.DS_Store']
      }),
    })
    const fileKeys = await srcStorage.getKeys()
    const filesToDeploy = fileKeys.filter(fileKey => {
      if (fileKey.startsWith('.wrangler:')) return false
      if (fileKey.startsWith('node_modules:')) return false
      if (fileKey === 'wrangler.toml') return false
      if (fileKey.startsWith('database:migrations:')) return false
      return true
    })
    const files = await Promise.all(filesToDeploy.map(async (fileKey) => {
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
    setTimeout(() => spinner.color = 'magenta', 2500)
    setTimeout(() => spinner.color = 'blue', 5000)
    setTimeout(() => spinner.color = 'yellow', 7500)
    const deployment = await $api(`/teams/${linkedProject.teamSlug}/projects/${linkedProject.slug}/deploy`, {
      method: 'POST',
      body: {
        git,
        files
      }
    }).catch((err) => {
      spinner.fail(`Failed to deploy ${colors.blue(linkedProject.slug)} to ${deployEnvColored}.`)
      // Error with workers size limit
      if (err.data?.data?.name === 'ZodError') {
        consola.error(err.data.data.issues)
      }
      else if (err.message.includes('Error: ')) {
        consola.error(err.message.split('Error: ')[1])
      } else {
        consola.error(err.message.split(' - ')[1] || err.message)
      }
      process.exit(1)
    })
    spinner.succeed(`Deployed ${colors.blue(linkedProject.slug)} to ${deployEnvColored}...`)

    // Apply migrations
    const hubModuleConfig = await srcStorage.getItem('hub.config.json')
    if (hubModuleConfig.database) {
      const remoteMigrationsSpinner = ora(`Retrieving migrations on ${deployEnvColored} for ${colors.blue(linkedProject.slug)}...`).start()

      await createMigrationsTable({ env: deployEnv })

      const remoteMigrations = await fetchRemoteMigrations({ env: deployEnv }).catch((error) => {
        remoteMigrationsSpinner.fail(`Could not retrieve migrations on ${deployEnvColored} for ${colors.blue(linkedProject.slug)}.`)
        consola.error(error.message)
        process.exit(1)
      })
      remoteMigrationsSpinner.succeed(`Found ${remoteMigrations.length} migration${remoteMigrations.length === 1 ? '' : 's'} on ${colors.blue(linkedProject.slug)}`)

      const localMigrations = fileKeys
        .filter(fileKey => {
          const isMigrationsDir = fileKey.startsWith('database:migrations:')
          const isSqlFile = fileKey.endsWith('.sql')
          return isMigrationsDir && isSqlFile
        })
        .map(fileName => {
          return fileName
            .replace('database:migrations:', '')
            .replace('.sql', '')
        })
      const pendingMigrations = localMigrations.filter(localName => !remoteMigrations.find(({ name }) => name === localName))
      if (!pendingMigrations.length) consola.info('No pending migrations to apply.')

      for (const migration of pendingMigrations) {
        const migrationSpinner = ora(`Applying migration ${colors.blue(migration)}...`).start()

        let query = await srcStorage.getItem(`database:migrations:${migration}.sql`)

        if (query.at(-1) !== ';') query += ';' // ensure previous statement ended before running next query
	      query += `
          INSERT INTO _hub_migrations (name) values ('${migration}');
        `;

        try {
          await queryDatabase({ env: deployEnv, query })
        } catch (error) {
          migrationSpinner.fail(`Failed to apply migration ${colors.blue(migration)}.`)

          if (error) consola.error(error.response?._data?.message || error.message)
          break
        }

        migrationSpinner.succeed(`Applied migration ${colors.blue(migration)}.`)
      }
    }

    // Check DNS & ready url for first deployment
    consola.success(`Deployment is ready at ${colors.cyan(deployment.primaryUrl || deployment.url)}`)
    if (deployment.isFirstDeploy) {
      consola.info('As this is the first deployment, please note that domain propagation may take a few minutes.')
    }

    process.exit(0)
  },
})
