import { hostname } from 'os'
import { consola } from 'consola'
import { colors } from 'consola/utils'
import { defineCommand } from 'citty'
import { isHeadless, fetchUser, updateUserConfig, $api, NUXT_HUB_URL } from '../utils/index.mjs'
import { createApp, eventHandler, toNodeListener, getQuery, sendRedirect } from 'h3'
import { getRandomPort } from 'get-port-please'
import { listen } from 'listhen'
import { withQuery, joinURL } from 'ufo'
import open from 'open'

export default defineCommand({
  meta: {
    name: 'login',
    description: 'Authenticate with NuxtHub.',
  },
  async setup() {
    if (isHeadless()) {
      throw new Error('nuxthub login is not supported in headless mode yet.')
    }
    const user = await fetchUser()
    if (user) {
      return consola.info(`Already logged in as ${colors.blue(user.name)}`)
    }
    // Create server for OAuth flow
    let listener
    const app = createApp()
    let handled = false
    // Get machine name
    const host = hostname().replace(/-/g, ' ').replace('.local', '').replace('.home', '').toLowerCase()
    const tokenName = `NuxtHub CLI on ${host}`
    // eslint-disable-next-line no-async-promise-executor
    await new Promise(async (resolve) => {
      app.use('/', eventHandler(async (event) => {
        if (handled)  return
        handled = true
        const code = getQuery(event).code

        if (code) {
          const { token } = await $api('/cli/verify', {
            method: 'POST',
            body: {
              code,
              name: tokenName
            }
          }).catch((err) => {
            console.error('Failed to verify session', err.message)
            return { token: null }
          })
          const user = await $api('/user', {
            headers: {
              Authorization: `Bearer ${token}`
            }
          }).catch((err) => {
            console.error('Failed to fetch user', err.message)
            return null
          })
          if (user?.name) {
            updateUserConfig({ hub: { userToken: token } })
            consola.success('Authenticated successfully!')

            resolve()
            return sendRedirect(event, joinURL(NUXT_HUB_URL, '/cli/status?success'))
          }
        }
        consola.error('Authentication error, please try again.')
        resolve()
        return sendRedirect(event, joinURL(NUXT_HUB_URL, '/cli/status?error'))
      }))
      const randomPort = await getRandomPort()
      listener = await listen(toNodeListener(app), {
        showURL: false,
        port: randomPort
      })
      const authUrl = withQuery(joinURL(NUXT_HUB_URL, '/api/cli/authorize'), { redirect: listener.url })
      consola.info('Please visit the following URL in your web browser:')
      consola.info(`\`${authUrl}\``)
      consola.info('Waiting for authentication to be completed...')
      open(authUrl)
    })
    // Close server after 1s to make sure we have time to handle the request
    await new Promise((resolve) => setTimeout(resolve, 1000))
    await listener.close()
  },
})
