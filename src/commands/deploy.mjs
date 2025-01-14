import ora from 'ora'
import { consola } from 'consola'
import { colors } from 'consola/utils'
import { isCancel, confirm } from '@clack/prompts'
import { defineCommand, runCommand } from 'citty'
import { joinURL } from 'ufo'
import { join, resolve, relative } from 'pathe'
import { createStorage } from 'unstorage'
import fsDriver from 'unstorage/drivers/fs'
import { execa } from 'execa'
import { existsSync } from 'fs'
import mime from 'mime'
import prettyBytes from 'pretty-bytes'
import { setupDotenv } from 'c12'
import { ofetch } from 'ofetch'
import { $api, fetchUser, selectTeam, selectProject, projectPath, withTilde, fetchProject, linkProject, hashFile, gitInfo, getPackageJson, MAX_ASSET_SIZE } from '../utils/index.mjs'
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

    const distDir = join(cwd, 'dist')
    if (!existsSync(distDir)) {
      consola.error(`${colors.cyan(withTilde(distDir))} directory not found, please make sure that you have built your project.`)
      process.exit(1)
    }
    const distStorage = createStorage({
      driver: fsDriver({
        base: distDir,
        ignore: ['.DS_Store']
      }),
    })
    const getFile = async (path, encoding = 'utf-8') => {
      const dataAsBuffer = await distStorage.getItemRaw(path)
      if (dataAsBuffer.length > MAX_ASSET_SIZE) {
        console.error(`NuxtHub deploy only supports files up to ${prettyBytes(MAX_ASSET_SIZE, { binary: true })} in size\n${withTilde(path)} is ${prettyBytes(dataAsBuffer.size, { binary: true })} in size`)
        process.exit(1)
      }
      const data = dataAsBuffer.toString(encoding)
      return {
        path,
        data,
        size: dataAsBuffer.length,
        encoding,
        hash: hashFile(data),
        contentType: mime.getType(path) || 'application/octet-stream'
      }
    }
    const fileKeys = await distStorage.getKeys()
    const fileKeyToPath = (fileKey) => joinURL('/', fileKey.replace(/:/g, '/'))
    const pathsToDeploy = fileKeys.map(fileKeyToPath).filter(path => {
      if (path.startsWith('/.wrangler/')) return false
      if (path.startsWith('/node_modules/')) return false
      if (path === '/wrangler.toml') return false
      if (path === '/.dev.vars') return false
      if (path.startsWith('/database/migrations/')) return false
      return true
    })

    const META_PATHS = [
      '/_redirects',
      '/_headers',
      '/_routes.json',
      '/nitro.json',
      '/hub.config.json',
      '/wrangler.toml',
    ]
    const isMetaPath = (path) => META_PATHS.includes(path)
    const isServerPath = (path) => path.startsWith('/_worker.js/')
    const isPublicPath = (path) => !isMetaPath(path) && !isServerPath(path)

    const spinner = ora(`Preparing ${colors.blue(linkedProject.slug)} deployment to ${deployEnvColored}...`).start()
    setTimeout(() => spinner.color = 'magenta', 2500)
    setTimeout(() => spinner.color = 'blue', 5000)
    setTimeout(() => spinner.color = 'yellow', 7500)

    let deployment
    try {
      const config = await distStorage.getItem('hub.config.json')
      const publicFiles = await Promise.all(pathsToDeploy.filter(isPublicPath).map(p => getFile(p, 'base64')))
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
      console.log('missingPublicHashes', missingPublicHashes)

      // Create chunks based on base64 size
      const MAX_CHUNK_SIZE = 50 * 1024 * 1024 // 50MiB chunk size (in bytes)
      const createChunks = async (files) => {
        const chunks = []
        let currentChunk = []
        let currentSize = 0

        for (const file of files) {
          // If single file is bigger than chunk size, it gets its own chunk
          if (file.size > MAX_CHUNK_SIZE) {
            // If we have accumulated files, push them as a chunk first
            if (currentChunk.length > 0) {
              chunks.push(currentChunk)
              currentChunk = []
              currentSize = 0
            }
            // Push large file as its own chunk
            chunks.push([file])
            continue
          }

          if (currentSize + file.size > MAX_CHUNK_SIZE && currentChunk.length > 0) {
            chunks.push(currentChunk)
            currentChunk = []
            currentSize = 0
          }

          currentChunk.push(file)
          currentSize += file.size
        }

        if (currentChunk.length > 0) {
          chunks.push(currentChunk)
        }

        return chunks
      }

      // Upload assets to Cloudflare with max concurrent uploads
      const CONCURRENT_UPLOADS = 3
      const publicFilesToUpload = publicFiles.filter(file => missingPublicHashes.includes(file.hash))
      const chunks = await createChunks(publicFilesToUpload)

      for (let i = 0; i < chunks.length; i += CONCURRENT_UPLOADS) {
        const chunkGroup = chunks.slice(i, i + CONCURRENT_UPLOADS)
        if (chunks.length > 1) {
          spinner.text = `Uploading (${i + 1}/${chunks.length})...`
        }
        await Promise.all(chunkGroup.map(async (filesInChunk) => {
          return ofetch('/pages/assets/upload', {
            baseURL: 'https://api.cloudflare.com/client/v4/',
            method: 'POST',
            headers: {
              Authorization: `Bearer ${cloudflareUploadJwt}`
            },
            // transform to Cloudflare format
            body: filesInChunk.map(file => ({
              path: file.path,
              key: file.hash,
              value: file.data,
              base64: true,
              metadata: {
                contentType: file.contentType
              }
            }))
          })
        }))
      }

      spinner.text = `Deploying ${colors.blue(linkedProject.slug)} to ${deployEnvColored}...`
      const serverFiles = await Promise.all(pathsToDeploy.filter(isServerPath).map(p => getFile(p, 'utf-8')))
      const metaFiles = await Promise.all(pathsToDeploy.filter(isMetaPath).map(p => getFile(p, 'utf-8')))
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

    // Apply migrations
    const hubModuleConfig = await distStorage.getItem('hub.config.json')
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

        let query = await distStorage.getItem(`database/migrations/${migration}.sql`)

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
