import { consola } from 'consola'
import { colors } from 'consola/utils'
import { defineCommand } from 'citty'
import { fetchUser } from '../utils/index.mjs'

export default defineCommand({
  meta: {
    name: 'whoami',
    description: 'Shows the username of the currently logged in user.',
  },
  async run() {
    const user = await fetchUser()
    if (!user) {
      consola.warn("Not currently logged in.");
      consola.warn("To login, run `nuxthub login`");
      return;
    }
    consola.info(`Logged in as ${colors.blue(user.name)}`)
  },
})
