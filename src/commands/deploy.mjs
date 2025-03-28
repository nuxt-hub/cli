import prettyBytes from 'pretty-bytes'
import ora from 'ora'
import { consola } from 'consola'
import { colors } from 'consola/utils'
import { isCancel, confirm } from '@clack/prompts'
import { defineCommand, runCommand } from 'citty'
import { join, resolve, relative } from 'pathe'
import { execa } from 'execa'
import { setupDotenv } from 'c12'
import { $api, fetchUser, selectTeam, selectProject, projectPath, fetchProject, linkProject, gitInfo } from '../utils/index.mjs'
import { getStorage, getPathsToDeploy, getFile, uploadAssetsToCloudflare, isMetaPath, isServerPath, getPublicFiles } from '../utils/deploy.mjs'
import { createMigrationsTable, fetchRemoteMigrations, queryDatabase } from '../utils/database.mjs'
import login from './login.mjs'
import ensure from './ensure.mjs'

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
        message: `Deploy ${colors.blueBright(projectPath())} to NuxtHub?`
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
    const deployEnvColored = deployEnv === 'production' ? colors.greenBright(deployEnv) : colors.yellowBright(deployEnv)
    consola.success(`Connected to ${colors.blueBright(linkedProject.teamSlug)} team.`)
    consola.success(`Linked to ${colors.blueBright(linkedProject.slug)} project.`)

    // #region Build
    if (args.build) {
      consola.info('Building the Nuxt project...')
      // Ensure the NuxtHub Core module is installed and registered in the project
      await runCommand(ensure, { rawArgs: [cwd] })

      const nuxiBuildArgs = []
      if (args.dotenv) {
        nuxiBuildArgs.push(`--dotenv=${args.dotenv}`)
      }
      await execa({ stdio: 'inherit', preferLocal: true, cwd, extendEnv: false, env: {} })`nuxi build ${nuxiBuildArgs}`
        .catch((err) => {
          if (err.code === 'ENOENT') {
            consola.error('`nuxt` is not installed, please make sure that you are inside a Nuxt project.')
            process.exit(1)
          }
          throw err
        })
    }
    // #endregion

    // #region Prepare deployment
    const distDir = join(cwd, 'dist')
    const storage = await getStorage(distDir).catch((err) => {
      consola.error(err.message.includes('directory not found') ? `${err.message}, please make sure that you have built your project.` : err.message)
      process.exit(1)
    })
    const fileKeys = await storage.getKeys()
    const pathsToDeploy = getPathsToDeploy(fileKeys)
    const config = await storage.getItem('hub.config.json')
    const { format: formatNumber } = new Intl.NumberFormat('en-US')

    let spinner = ora(`Preparing ${colors.blueBright(linkedProject.slug)} deployment for ${deployEnvColored}...`).start()
    const spinnerColors = ['magenta', 'blue', 'yellow', 'green']
    let spinnerColorIndex = 0
    const spinnerColorInterval = setInterval(() => {
      spinner.color = spinnerColors[spinnerColorIndex]
      spinnerColorIndex = (spinnerColorIndex + 1) % spinnerColors.length
    }, 2500)

    let deploymentKey, serverFiles, metaFiles
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
      spinner.succeed(`${colors.blueBright(linkedProject.slug)} ready to deploy.`)
      const { missingPublicHashes, cloudflareUploadJwt } = deploymentInfo
      deploymentKey = deploymentInfo.deploymentKey
      const publicFilesToUpload = publicFiles.filter(file => missingPublicHashes.includes(file.hash))

      if (publicFilesToUpload.length) {
        const totalSizeToUpload = publicFilesToUpload.reduce((acc, file) => acc + file.size, 0)
        spinner = ora(`Uploading ${colors.blueBright(formatNumber(publicFilesToUpload.length))} new static assets (${colors.blueBright(prettyBytes(totalSizeToUpload))})...`).start()
        await uploadAssetsToCloudflare(publicFilesToUpload, cloudflareUploadJwt, ({ progressSize, totalSize }) => {
          const percentage = Math.round((progressSize / totalSize) * 100)
          spinner.text = `${percentage}% uploaded (${prettyBytes(progressSize)}/${prettyBytes(totalSize)})...`
        })
        spinner.succeed(`${colors.blueBright(formatNumber(publicFilesToUpload.length))} new static assets uploaded (${colors.blueBright(prettyBytes(totalSizeToUpload))})`)
      }

      if (publicFiles.length) {
        const totalSize = publicFiles.reduce((acc, file) => acc + file.size, 0)
        const totalGzipSize = publicFiles.reduce((acc, file) => acc + file.gzipSize, 0)
        consola.info(`${colors.blueBright(formatNumber(publicFiles.length))} static assets (${colors.blueBright(prettyBytes(totalSize))} / ${colors.blueBright(prettyBytes(totalGzipSize))} gzip)`)
      }

      metaFiles = await Promise.all(pathsToDeploy.filter(isMetaPath).map(p => getFile(storage, p, 'base64')))
      serverFiles = await Promise.all(pathsToDeploy.filter(isServerPath).map(p => getFile(storage, p, 'base64')))
      const serverFilesSize = serverFiles.reduce((acc, file) => acc + file.size, 0)
      const serverFilesGzipSize = serverFiles.reduce((acc, file) => acc + file.gzipSize, 0)
      consola.info(`${colors.blueBright(formatNumber(serverFiles.length))} server files (${colors.blueBright(prettyBytes(serverFilesSize))} / ${colors.blueBright(prettyBytes(serverFilesGzipSize))} gzip)...`)
    } catch (err) {
      spinner.fail(`Failed to deploy ${colors.blueBright(linkedProject.slug)} to ${deployEnvColored}.`)
      consola.debug(err, err.data)

      if (err.data) {
        consola.error(err.data.data?.issues || err.data.statusMessage || err.data.message || err.data)
      }
      else {
        consola.error(err.message.split(' - ')[1] || err.message)
      }
      process.exit(1)
    }

    if (config.database) {
      // #region Database migrations
      const remoteMigrationsSpinner = ora(`Retrieving database migrations on ${deployEnvColored} for ${colors.blueBright(linkedProject.slug)}...`).start()

      await createMigrationsTable({ env: deployEnv })

      const remoteMigrations = await fetchRemoteMigrations({ env: deployEnv }).catch((error) => {
        remoteMigrationsSpinner.fail(`Could not retrieve database migrations on ${deployEnvColored} for ${colors.blueBright(linkedProject.slug)}.`)
        consola.error(error.message)
        process.exit(1)
      })
      remoteMigrationsSpinner.succeed(`Found ${remoteMigrations.length} database migration${remoteMigrations.length === 1 ? '' : 's'} on ${colors.blueBright(linkedProject.slug)}`)

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
      if (!pendingMigrations.length) consola.info('No pending database migrations to apply.')

      for (const migration of pendingMigrations) {
        const migrationSpinner = ora(`Applying database migration ${colors.blueBright(migration)}...`).start()

        let query = await storage.getItem(`database/migrations/${migration}.sql`)

        if (query.at(-1) !== ';') query += ';' // ensure previous statement ended before running next query
	      query += `
          INSERT INTO _hub_migrations (name) values ('${migration}');
        `;

        try {
          await queryDatabase({ env: deployEnv, query })
        } catch (error) {
          migrationSpinner.fail(`Failed to apply database migration ${colors.blueBright(migration)}.`)

          if (error) consola.error(error.response?._data?.message || error.message)
          break
        }

        migrationSpinner.succeed(`Applied database migration ${colors.blueBright(migration)}.`)
      }
      // #endregion

      // #region Database queries
      const localQueries = fileKeys
        .filter(fileKey => fileKey.startsWith('database:queries:') && fileKey.endsWith('.sql'))
        .map(fileKey => fileKey.replace('database:queries:', '').replace('.sql', ''))


      if (localQueries.length) {
        const querySpinner = ora(`Applying ${colors.blueBright(formatNumber(localQueries.length))} database ${localQueries.length === 1 ? 'query' : 'queries'}...`).start()
        for (const queryName of localQueries) {
          const query = await storage.getItem(`database/queries/${queryName}.sql`)

          try {
            await queryDatabase({ env: deployEnv, query })
          } catch (error) {
            querySpinner.fail(`Failed to apply database query ${colors.blueBright(queryName)}.`)

            if (error) consola.error(error.response?._data?.message || error.message)
            break
          }

        }
        querySpinner.succeed(`Applied ${colors.blueBright(formatNumber(localQueries.length))} database ${localQueries.length === 1 ? 'query' : 'queries'}.`)
      }
      // #endregion
    }

    // #region Complete deployment
    spinner = ora(`Deploying ${colors.blueBright(linkedProject.slug)} to ${deployEnvColored}...`).start()
    const deployment = await $api(`/teams/${linkedProject.teamSlug}/projects/${linkedProject.slug}/${deployEnv}/deploy/complete`, {
      method: 'POST',
      body: {
        deploymentKey,
        git,
        serverFiles,
        metaFiles
      },
    }).catch((err) => {
      spinner.fail(`Failed to deploy ${colors.blueBright(linkedProject.slug)} to ${deployEnvColored}.`)
      // Error with workers size limit
      if (err.data?.data?.name === 'ZodError') {
        consola.error(err.data.data.issues)
      }
      else if (err.message.includes('- Error: ')) {
        consola.error(err.message.split('- Error: ')[1])
      } else {
        consola.error(err.message.split(' - ')[1] || err.message)
      }
      process.exit(1)
    })
    spinner.succeed(`Deployed ${colors.blueBright(linkedProject.slug)} to ${deployEnvColored}...`)

    // Check DNS & ready url for first deployment
    consola.success(`Deployment is ready at ${colors.cyanBright(deployment.primaryUrl || deployment.url)}`)
    if (deployment.isFirstDeploy) {
      consola.info('As this is the first deployment, please note that domain propagation may take a few minutes.')
    }

    clearInterval(spinnerColorInterval)
    process.exit(0)
  },
})
