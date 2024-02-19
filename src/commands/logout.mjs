import { consola } from 'consola'
import { defineCommand } from 'citty'
import { $api, fetchUser, loadUserConfig, writeUserConfig } from '../utils/index.mjs'

export default defineCommand({
  meta: {
    name: 'logout',
    description: 'Logout the current authenticated user.',
  },
  async setup() {
    const user = await fetchUser()
    if (!user) {
      consola.info('Not currently logged in.')
      return
    }

    await $api('/user/token', {
      method: 'DELETE'
    }).catch(() => {})

    const config = loadUserConfig()
    delete config.hub.userToken
    writeUserConfig(config)

    consola.info('You have been logged out.')
  },
})
