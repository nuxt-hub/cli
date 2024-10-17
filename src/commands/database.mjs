import { consola } from 'consola'
import { defineCommand } from 'citty'
import { join } from 'pathe'
import { createStorage } from 'unstorage'
import fsDriver from 'unstorage/drivers/fs'

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
    const cwd = process.cwd()
    const migrationsDir = join(cwd, 'server/migrations')
    const srcStorage = createStorage({
      driver: fsDriver({
        base: migrationsDir,
        ignore: ['.DS_Store']
      }),
    })

    const fileKeys = await srcStorage.getKeys()
    const sqlFiles = fileKeys.filter(file => file.endsWith('.sql'))

    // only get files with a 4 digit number prefix (0000_)
    const lastSequentialMigrationNumber = sqlFiles
      .map(file => file.split('_')[0])
      .map(num => parseInt(num))
      .sort((a, b) => a - b)
      .pop() ?? 0

    const nextMigrationNumber = (lastSequentialMigrationNumber + 1).toString().padStart(4, '0')
    const name = args.name
      .trim()
      .toLowerCase()
      .replace(/[^a-zA-Z0-9\s\n]/g, '') // remove special characters except spaces and newlines
      .replace(/[\s\n]+/g, '-') // replace spaces and newlines with dashes
      .replace(/^-+/, '') // remove leading and trailing dashes
      || 'migration'
    const migrationName = `${nextMigrationNumber}_${name}.sql`
    await srcStorage.set(migrationName, `-- Migration number: ${nextMigrationNumber} \t ${new Date().toISOString()}\n`)

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
