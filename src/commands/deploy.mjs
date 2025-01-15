import ora from 'ora'
import { consola } from 'consola'
import { colors } from 'consola/utils'
import { isCancel, confirm } from '@clack/prompts'
import { defineCommand, runCommand } from 'citty'
import { join, resolve, relative } from 'pathe'
import { execa } from 'execa'
import { setupDotenv } from 'c12'
import { $api, fetchUser, selectTeam, selectProject, projectPath, fetchProject, linkProject, gitInfo, getPackageJson } from '../utils/index.mjs'
import { getStorage, getPathsToDeploy, getFile, uploadAssetsToCloudflare, isMetaPath, isServerPath, getPublicFiles } from '../utils/deploy.mjs'
import { createMigrationsTable, fetchRemoteMigrations, queryDatabase } from '../utils/database.mjs'
import login from './login.mjs'

export default defineCommand({
  meta: {
    name: 'deploy',
    description: 'Deploy your project to NuxtHub.',
  },
  args: {
    cwd: {
      type: 'positional',
      description: 'The directory to build and deploy.',
      required: false,
      default: '.'
    },
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
    const cmdCwd = process.cwd()
    const cwd = resolve(cmdCwd, args.cwd)
    if (args.dotenv) {
      consola.info(`Loading env from \`${args.dotenv}\``)
      await setupDotenv({
        cwd,
        fileName: args.dotenv
      })
    } else if (cwd !== cmdCwd) {
      consola.info(`Loading env from \`${relative(cmdCwd, cwd)}/.env\``)
      await setupDotenv({
        cwd,
        fileName: '.env'
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
    // Default to main branch
    git.branch = git.branch || 'main'
    let deployEnv = git.branch === linkedProject.productionBranch ? 'production' : 'preview'
    if (args.production) {
      git.branch = linkedProject.productionBranch
      deployEnv = 'production'
    } else if (args.preview) {
      if (git.branch === linkedProject.productionBranch) {
        git.branch += '-preview'
      }
      deployEnv = 'preview'
    }
    const deployEnvColored = deployEnv === 'production' ? colors.green(deployEnv) : colors.yellow(deployEnv)
    consola.success(`Connected to ${colors.blue(linkedProject.teamSlug)} team.`)
    consola.success(`Linked to ${colors.blue(linkedProject.slug)} project.`)

    // #region Build
    if (args.build) {
      consola.info('Building the Nuxt project...')
      const pkg = await getPackageJson(cwd)
      const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies)
      if (!deps['@nuxthub/core']) {
        consola.error('`@nuxthub/core` is not installed, make sure to install it with `npx nuxt module add hub`')
        process.exit(1)
      }
      const nuxiBuildArgs = []
      if (args.dotenv) {
        nuxiBuildArgs.push(`--dotenv=${args.dotenv}`)
      }
      await execa({ stdio: 'inherit', preferLocal: true, cwd })`nuxi build ${nuxiBuildArgs}`
        .catch((err) => {
          if (err.code === 'ENOENT') {
            consola.error('`nuxt` is not installed, please make sure that you are inside a Nuxt project.')
            process.exit(1)
          }
          throw err
        })
    }
    // #endregion

    // #region Deploy
    const distDir = join(cwd, 'dist')
    const storage = await getStorage(distDir).catch((err) => {
      consola.error(err.message.includes('directory not found') ? `${err.message}, please make sure that you have built your project.` : err.message)
      process.exit(1)
    })
    const fileKeys = await storage.getKeys()
    const pathsToDeploy = getPathsToDeploy(fileKeys)
    const config = await storage.getItem('hub.config.json')

    const spinner = ora(`Preparing ${colors.blue(linkedProject.slug)} deployment to ${deployEnvColored}...`).start()
    setTimeout(() => spinner.color = 'magenta', 2500)
    setTimeout(() => spinner.color = 'blue', 5000)
    setTimeout(() => spinner.color = 'yellow', 7500)

    let deployment
    try {
      const publicFiles = await getPublicFiles(storage, pathsToDeploy)

      const deploymentInfo = await $api(`/teams/${linkedProject.teamSlug}/projects/${linkedProject.slug}/${deployEnv}/deploy/prepare`, {
        method: 'POST',
        body: {
          config,
          /**
           * Public manifest is a map of file paths to their unique hash (SHA256 sliced to 32 characters).
           * @example
           * {
           *   "/index.html": "hash",
           *   "/assets/image.png": "hash"
           * }
           */
          publicManifest: publicFiles.reduce((acc, file) => {
            acc[file.path] = file.hash
            return acc
          }, {})
        }
      })
      const { deploymentKey, missingPublicHashes, cloudflareUploadJwt } = deploymentInfo
      const publicFilesToUpload = publicFiles.filter(file => missingPublicHashes.includes(file.hash))

      for await (const { current, total } of uploadAssetsToCloudflare(publicFilesToUpload, cloudflareUploadJwt)) {
        spinner.text = `Uploading (${current}/${total})...`
      }

      spinner.text = `Deploying ${colors.blue(linkedProject.slug)} to ${deployEnvColored}...`
      const serverFiles = await Promise.all(pathsToDeploy.filter(isServerPath).map(p => getFile(storage, p, 'utf-8')))
      const metaFiles = await Promise.all(pathsToDeploy.filter(isMetaPath).map(p => getFile(storage, p, 'utf-8')))
      deployment = await $api(`/teams/${linkedProject.teamSlug}/projects/${linkedProject.slug}/${deployEnv}/deploy/complete`, {
        method: 'POST',
        body: {
          deploymentKey,
          git,
          serverFiles,
          metaFiles
        },
      })
    } catch (err) {
      spinner.fail(`Failed to deploy ${colors.blue(linkedProject.slug)} to ${deployEnvColored}.`)
      console.log('err', err)
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
    }

    spinner.succeed(`Deployed ${colors.blue(linkedProject.slug)} to ${deployEnvColored}...`)

    // #region Database migrations
    if (config.database) {
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

        let query = await storage.getItem(`database/migrations/${migration}.sql`)

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
