import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Localdrive } from '../src/localdrive'


async function cleanup(cwd: string): Promise<void> {
  await rm(cwd, { force: true, recursive: true })
}

describe('seed', () => {
  it('applies seed sql to the template after migrations', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'localdrive-seed-'))
    const migration = join(cwd, 'migration.sql')
    const seed = join(cwd, 'seed.sql')

    await writeFile(migration, 'CREATE TABLE items (id serial primary key, name text);')
    await writeFile(seed, 'INSERT INTO items (name) VALUES (\'seeded\');')

    const controller = new Localdrive({
      bindings: {
        DB: {
          migrations: migration,
          seed
        }
      },
      cwd
    })

    try {
      await controller.initialize()

      const databases = await controller.createTestDatabases()
      const db = databases.DB

      if (db === undefined) {
        throw new Error('Missing DB')
      }

      const rows = await db.testQuery<{ name: string }>('SELECT name FROM items')

      expect(rows).toHaveLength(1)
      expect(rows[0]?.name).toBe('seeded')

      await db.close()
    } finally {
      await controller.close()
      await cleanup(cwd)
    }
  })

  it('still supports legacy snapshot option', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'localdrive-snapshot-'))
    const migration = join(cwd, 'migration.sql')
    const snapshot = join(cwd, 'snapshot.sql')

    await writeFile(migration, 'CREATE TABLE items (id serial primary key, name text);')
    await writeFile(snapshot, 'INSERT INTO items (name) VALUES (\'snapshot\');')

    const controller = new Localdrive({
      bindings: {
        DB: {
          migrations: migration,
          snapshot
        }
      },
      cwd
    })

    try {
      await controller.initialize()

      const databases = await controller.createTestDatabases()
      const db = databases.DB

      if (db === undefined) {
        throw new Error('Missing DB')
      }

      const rows = await db.testQuery<{ name: string }>('SELECT name FROM items')

      expect(rows).toHaveLength(1)
      expect(rows[0]?.name).toBe('snapshot')

      await db.close()
    } finally {
      await controller.close()
      await cleanup(cwd)
    }
  })
})
