import { defineCommand } from 'citty'
import { consola } from 'consola'
import { useMigrationsStorage, getNextMigrationNumber } from '../../../utils/database.mjs'

export default defineCommand({
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
      .replace(/[^a-zA-Z0-9\s\n-]/g, '') // remove special characters except spaces, newlines and dashes
      .replace(/[\s\n]+/g, '-') // replace spaces and newlines with dashes
      .replace(/^-+/, '') // remove leading and trailing dashes
      .replace(/-+/g, '-') // replace multiple dashes with a single dash
      || 'migration'
    const migrationName = `${nextMigrationNumber}_${name}.sql`
    await useMigrationsStorage().set(migrationName, `-- Migration number: ${nextMigrationNumber} \t ${new Date().toISOString()}\n`)

    consola.success(`Created migration file \`server/migrations/${migrationName}\``)
  }
});
