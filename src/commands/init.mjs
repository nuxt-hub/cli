import { defineCommand } from 'citty'
import { execa } from 'execa'

export default defineCommand({
  meta: {
    name: 'init',
    description: 'Initialize a fresh NuxtHub project, alias of `nuxi init -t hub`.',
  },
  async run({ args }) {
    await execa('npx', ['nuxi@latest', 'init', '-t', 'hub', '--package-manager', 'pnpm', ...args._], { stdio: 'inherit' })
  },
})
