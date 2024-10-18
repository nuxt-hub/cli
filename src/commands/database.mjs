import { consola } from 'consola'
import { defineCommand } from 'citty'
import { useMigrationsStorage, getMigrationFiles, getNextMigrationNumber } from '../utils/database.mjs'
import { getProjectEnv } from '../utils/git.mjs';

const createMigration = defineCommand({
  meta: {
    name: 'create',
    description: 'Create a new blank database migration file.',
  },
  args: {
    name: {
      type: 'positional',
      description: 'Name of the migration.',
      required: true
    },
  },
  async run({ args }) {
    const nextMigrationNumber = await getNextMigrationNumber()
    const name = args.name
      .trim()
      .toLowerCase()
      .replace(/[^a-zA-Z0-9\s\n]/g, '') // remove special characters except spaces and newlines
      .replace(/[\s\n]+/g, '-') // replace spaces and newlines with dashes
      .replace(/^-+/, '') // remove leading and trailing dashes
      || 'migration'
    const migrationName = `${nextMigrationNumber}_${name}.sql`
    await useMigrationsStorage().set(migrationName, `-- Migration number: ${nextMigrationNumber} \t ${new Date().toISOString()}\n`)

    consola.success(`Created migration file \`server/migrations/${migrationName}\``)
  }
});

const migrations = defineCommand({
  meta: {
    name: 'migrations',
    description: 'Database migrations commands.',
  },
  subCommands: [
    createMigration
  ]
});

export default defineCommand({
  meta: {
    name: 'database',
    description: 'Database management commands.',
  },
  subCommands: [
    migrations
  ]
});
