import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Localdrive } from '../src/localdrive'
import { createLocaldriveClient } from '../src/cloudflare-test-client'


describe('createLocaldriveClient', () => {
  it('queries a cloned database', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'localdrive-client-'))
    const setup = join(cwd, 'setup.sql')
    await writeFile(setup, 'CREATE TABLE data (value text);')

    const controller = new Localdrive({
      bindings: {
        DB: {
          beforeEach: setup
        }
      },
      cwd
    })

    try {
      await controller.initialize()

      const databases = await controller.createTestDatabases()
      const database = databases.DB

      if (database === undefined) {
        throw new Error('Missing DB')
      }

      const db = createLocaldriveClient(database)

      try {
        await db.query('INSERT INTO data (value) VALUES ($1)', [ 'hello' ])

        const rows = await db.query<{ value: string }>('SELECT value FROM data')

        expect(rows).toHaveLength(1)
        expect(rows[0]?.value).toBe('hello')
      } finally {
        await db.end()
        await database.close()
      }
    } finally {
      await controller.close()
      await rm(cwd, { force: true, recursive: true })
    }
  })
})
