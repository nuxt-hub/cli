import { defineCommand } from 'citty'
import migrations from './database/migrations.mjs'

export default defineCommand({
  meta: {
    name: 'database',
    description: 'Manage database migrations.',
  },
  subCommands: {
    migrations
  }
});
