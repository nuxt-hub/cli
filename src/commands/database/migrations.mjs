import { defineCommand } from 'citty'
import create from './migrations/create.mjs'
import list from './migrations/list.mjs'
import markAllApplied from './migrations/mark-all-applied.mjs'

export default defineCommand({
  meta: {
    name: 'migrations',
    description: 'Database migrations commands.',
  },
  subCommands: {
    create,
    list,
    'mark-all-applied': markAllApplied
  }
});
