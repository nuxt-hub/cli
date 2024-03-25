import { colors } from 'consola/utils'
import dns2 from 'dns2'
import { ofetch } from 'ofetch'
import ora from 'ora'

const TIMEOUT = 1000 * 60 * 5
const POLL_INTERVAL = 1000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Inspired by https://github.com/cloudflare/workers-sdk/blob/b58ed9f2e7236e0e88f936bbf946f310ca3cf37f/packages/create-cloudflare/src/helpers/poll.ts#L20

export async function pollDns (url) {
  const start = Date.now()
  const s = ora().start('Waiting for DNS to propagate')
  const domain = new URL(url).host

  // Start out by sleeping for 10 seconds since it's unlikely DNS changes will
  await sleep(10 * 1000)

  while (Date.now() - start < TIMEOUT) {
    s.text =`Waiting for DNS to propagate (${secondsSince(start)}s)`
    if (await isDomainResolvable(domain)) {
      s.succeed(`DNS propagation ${colors.cyan('complete')}.`)
      return
    }
    await sleep(POLL_INTERVAL)
  }
  s.fail(`Timed out while waiting for ${colors.cyan(url)} - try accessing it in a few minutes.`)
}

export async function pollHttp (url) {
  const start = Date.now()
  const s = ora('Waiting for deployment to become available').start()

  while (Date.now() - start < TIMEOUT) {
    s.text = `Waiting for deployment to become available ${secondsSince(start) > 3 ? `(${secondsSince(start)}s)` : ''}`
    try {
      const response = await ofetch.raw(url, {
        reset: true,
        headers: { 'Cache-Control': 'no-cache' },
      })
      if (response.status < 300) {
        s.succeed(`Deployment is ready at ${colors.cyan(url)}`)
        return true
      }
    } catch (e) {
      if (e.response?.status === 401) {
        s.succeed(`Deployment is ready at ${colors.cyan(url)}`)
        return true
      }
      if (e.response && e.response.status !== 404) {
        s.fail(e.message)
        process.exit(1)
      }
    }
    await sleep(POLL_INTERVAL)
  }
}

// Determines if the domain is resolvable via DNS. Until this condition is true,
// any HTTP requests will result in an NXDOMAIN error.
export const isDomainResolvable = async (domain) => {
  try {
    const nameServers = await lookupSubdomainNameservers(domain)

    // If the subdomain nameservers aren't resolvable yet, keep polling
    if (nameServers.length === 0) return false

    // Once they are resolvable, query these nameservers for the domain's 'A' record
    const dns = new dns2({ nameServers })
    const res = await dns.resolve(domain, 'A')
    return res.answers.length > 0
  } catch (error) {
    return false
  }
}

// Looks up the nameservers that are responsible for this particular domain
export const lookupSubdomainNameservers = async (domain) => {
  const nameServers = await lookupDomainLevelNameservers(domain)
  const dns = new dns2({ nameServers })
  const res = await dns.resolve(domain, 'NS')

  return (
    res.authorities
      // Filter out non-authoritative authorities (ones that don't have an 'ns' property)
      .filter((r) => Boolean(r.ns))
      // Return only the hostnames of the authoritative servers
      .map((r) => r.ns)
  )
}

// Looks up the nameservers responsible for handling `pages.dev` or `workers.dev` domains
export const lookupDomainLevelNameservers = async (domain) => {
  // Get the last 2 parts of the domain (ie. `pages.dev` or `workers.dev`)
  const baseDomain = domain.split('.').slice(-2).join('.')

  const dns = new dns2({})
  const nameservers = await dns.resolve(baseDomain, 'NS')
  return (nameservers.answers).map((n) => n.ns)
}

function secondsSince(start) {
  return Math.round((Date.now() - start) / 1000)
}
