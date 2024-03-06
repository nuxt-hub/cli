import { defineCommand } from 'citty'
import { execa } from 'execa'

export default defineCommand({
  meta: {
    name: 'init',
    description: 'Initialize a fresh NuxtHUb project, alias of `nuxi init -t hub`.',
  },
  async setup({ args }) {
    await execa('npx', ['nuxi@latest', 'init', '-t', 'hub', ...args._], { stdio: 'inherit' })
  },
})
