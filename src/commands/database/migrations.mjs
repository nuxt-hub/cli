import { defineCommand } from 'citty'
import create from './migrations/create.mjs'
import list from './migrations/list.mjs'
import markAllApplied from './migrations/mark-all-applied.mjs'
import { consola } from 'consola'

export default defineCommand({
  meta: {
    name: 'migrations',
    description: 'Database migrations commands.',
  },
  async setup() {
    consola.info('Make sure to run `npx nuxi prepare` before running this command if some migrations are missing.')
  },
  subCommands: {
    create,
    list,
    'mark-all-applied': markAllApplied
  }
});
