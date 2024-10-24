import { defineCommand } from 'citty'
import create from './migrations/create.mjs'
import list from './migrations/list.mjs'

export default defineCommand({
  meta: {
    name: 'migrations',
    description: 'Database migrations commands.',
  },
  subCommands: {
    create,
    list
  }
});
