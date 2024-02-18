#!/usr/bin/env node
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { defineCommand, runMain } from 'citty'
import updateNotifier from 'update-notifier'
import { loadJsonFileSync } from 'load-json-file'
import consola from 'consola'
import { colors } from 'consola/utils'
import link from './commands/link.mjs'
import unlink from './commands/unlink.mjs'
import login from './commands/login.mjs'
import logout from './commands/logout.mjs'
import whoami from './commands/whoami.mjs'
import deploy from './commands/deploy.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = loadJsonFileSync(resolve(__dirname, '../package.json'))
updateNotifier({ pkg }).notify()

const main = defineCommand({
  meta: {
    name: 'nuxthub',
    description: 'NuxtHub CLI',
    version: pkg.version,
  },
  setup({ args, cmd }) {
    if (args._.length) {
      consola.log(colors.gray(`${cmd.meta.description}`))
    }
  },
  subCommands: {
    deploy,
    link,
    unlink,
    login,
    logout,
    whoami
  },
})

runMain(main)
