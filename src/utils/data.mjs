import { consola } from 'consola'
import { colors } from 'consola/utils'
import { isCancel, select, text, password } from '@clack/prompts'
import { joinURL } from 'ufo'
import { ofetch } from 'ofetch'
import { gitInfo } from './git.mjs'
import { NUXT_HUB_URL, loadUserConfig } from './config.mjs'
import ora from 'ora'

export const $api = ofetch.create({
  baseURL: joinURL(NUXT_HUB_URL, '/api'),
  onRequest({ request, options }) {
    if (!options.headers.has('Authorization')) {
      options.headers.set('Authorization', `Bearer ${loadUserConfig().hub?.userToken || process.env.NUXT_HUB_USER_TOKEN || ''}`)
    }
    consola.debug(`Fetching \`${joinURL(options.baseURL, request)}\``)
  },
  onResponseError(ctx) {
    consola.debug(`Error when fetching \`${ctx.request}\``)
    if (ctx.response._data?.message) {
      ctx.error = new Error(`- ${ctx.response._data.message}`)
    }
    if (ctx.response._data?.data) {
      consola.debug(ctx.response._data?.data)
    }
  }
})

export function fetchUser() {
  if (!loadUserConfig().hub?.userToken && !process.env.NUXT_HUB_USER_TOKEN) {
    return null
  }
  return $api('/user').catch(() => {
    return null
  })
}

export async function selectTeam() {
  const teams = await $api('/teams')
  let team
  if (teams.length > 1) {
    const teamId = await select({
      message: 'Select a team',
      options: teams.map((team) => ({
        value: team.id,
        label: team.name
      }))
    })
    if (isCancel(teamId)) return null
    team = teams.find((team) => team.id === teamId)
  } else {
    team = teams[0]
  }

  if (!team.cloudflareAccountId) {
    return await linkCloudflareAccount(team)
  }
  return team
}

export async function linkCloudflareAccount(team, retry = false) {
  if (!retry) {
    const tokenLink = joinURL(NUXT_HUB_URL, `cloudflare-token?name=NuxtHub+Team+${team.name}`)
    consola.info(`You need to link your Cloudflare account to the \`${team.name}\` team.`)
    consola.info(`Create a new Cloudflare API token by following this link:\n\`${encodeURI(tokenLink)}\``)
  }
  let apiToken = await password({
    message: 'Cloudflare API token'
  })
  if (isCancel(apiToken)) return null

  const cfAccounts = await $api('/cloudflare/accounts', {
    params: { apiToken }
  }).catch(() => {
    consola.error('Couldn\'t list Cloudflare accounts\nPlease check your API Token, make sure to have "Account Settings: Read" permission.')
    return null
  })
  if (!cfAccounts) return linkCloudflareAccount(team, true)

  let accountId
  if (cfAccounts.length > 1) {
    accountId = await select({
      message: 'Select a Cloudflare account',
      options: cfAccounts
    })
  } else {
    accountId = cfAccounts[0].value
  }
  if (isCancel(accountId)) return null

  const spinner = ora('Linking Cloudflare account...').start()
  const account = await $api(`/teams/${team.slug}/accounts/cloudflare`, {
    method: 'PUT',
    body: { apiToken, accountId }
  })
    .catch((err) => {
      spinner.fail(err.data?.message || err.message)
      return null
    })
  if (!account) return linkCloudflareAccount(team, true)
  spinner.succeed('Cloudflare account linked.')

  return team
}

export async function selectProject(team) {
  const projects = await $api(`/teams/${team.slug}/projects`)
  let projectId
  if (projects.length) {
    projectId = await select({
      message: 'Select a project',
      options: [
        { value: 'new', label: 'Create a new project' },
        ...projects.map((project) => ({
          value: project.id,
          label: project.slug
        }))
      ]
    })
    if (isCancel(projectId)) return null
  } else {
    projectId = 'new'
  }

  let project
  if (projectId === 'new') {
    const defaultProjectName = process.cwd().split('/').pop()
    let projectName = await text({
      message: 'Project name',
      placeholder: defaultProjectName
    })
    if (isCancel(projectName)) return null
    projectName = projectName || defaultProjectName
    const projectLocation = await select({
      message: 'Select a region for the storage',
      initialValue: 'weur',
      options: [
        { label: 'Western Europe', value: 'weur' },
        { label: 'Eastern Europe', value: 'eeur' },
        { label: 'Western North America', value: 'wnam' },
        { label: 'Eastern North America', value: 'enam' },
        { label: 'Asia Pacific', value: 'apac' }
      ]
    })
    if (isCancel(projectLocation)) return null
    const git = gitInfo()
    const defaultProductionBranch = git.branch || 'main'
    const productionBranch = await text({
      message: 'Production branch (git)',
      placeholder: defaultProductionBranch
    })
    if (isCancel(productionBranch)) return null

    const spinner = ora(`Creating ${colors.blueBright(projectName)} project...`).start()
    setTimeout(() => spinner.color = 'magenta', 2500)
    setTimeout(() => spinner.color = 'blue', 5000)
    setTimeout(() => spinner.color = 'yellow', 7500)
    project = await $api(`/teams/${team.slug}/projects`, {
      method: 'POST',
      body: {
        name: projectName,
        location: projectLocation,
        productionBranch: productionBranch || defaultProductionBranch
      }
    }).catch((err) => {
      if (err.response?._data?.message?.includes('Cloudflare credentials')) {
        spinner.fail('You need to link your Cloudflare account to create a project.')
        consola.info('Please configure it in your team settings:')
        consola.info(`\`${joinURL(NUXT_HUB_URL, team.slug, '/settings/cloudflare')}\`\n`)
        process.exit(1)
      }
      if (err.response?._data?.message?.includes('Cloudflare account')) {
        spinner.fail(err.response._data.message)
        process.exit(1)
      }
      throw err
    })
    spinner.succeed(`Project ${colors.blueBright(project.slug)} created`)
  } else {
    project = projects.find((project) => project.id === projectId)
  }

  return project
}

export async function fetchProject() {
  if (process.env.NUXT_HUB_PROJECT_KEY) {
    return $api(`/projects/${process.env.NUXT_HUB_PROJECT_KEY}`).catch(() => null)
  }
  return null
}
