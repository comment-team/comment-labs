import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Localdrive } from '../src/localdrive'
import { createLocaldriveClient, resetLocaldriveDatabase } from '../src/query-client'


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

  it('resets the underlying database and refreshes the connection', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'localdrive-client-reset-'))
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
        await db.reset()

        const rows = await db.query<{ value: string }>('SELECT value FROM data')

        expect(rows).toHaveLength(0)
      } finally {
        await db.end()
        await database.close()
      }
    } finally {
      await controller.close()
      await rm(cwd, { force: true, recursive: true })
    }
  })

  it('resetLocaldriveDatabase uses the control URL in Cloudflare Worker mode', async () => {
    expect.hasAssertions()

    const controlUrl = 'http://127.0.0.1:19876/reset'

    Reflect.set(globalThis, 'WebSocketPair', undefined)

    let requestedUrl: string | undefined
    let requestBody: unknown

    Reflect.set(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      requestedUrl = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url
      requestBody = init?.body

      return new Response(null, { status: 204 })
    })

    try {
      await resetLocaldriveDatabase('postgresql://postgres@127.0.0.1:12345/postgres', { env: { LOCALDRIVE_CONTROL_URL: controlUrl } })

      expect(requestedUrl).toBe(controlUrl)
      expect(requestBody).toBe(JSON.stringify({ connectionString: 'postgresql://postgres@127.0.0.1:12345/postgres' }))
    } finally {
      Reflect.deleteProperty(globalThis, 'WebSocketPair')
      Reflect.deleteProperty(globalThis, 'fetch')
    }
  })

  it('resetLocaldriveDatabase throws when the control request fails', async () => {
    expect.hasAssertions()

    Reflect.set(globalThis, 'WebSocketPair', undefined)

    Reflect.set(globalThis, 'fetch', async (): Promise<Response> => new Response(null, { status: 500 }))

    try {
      await expect(resetLocaldriveDatabase('postgresql://postgres@127.0.0.1:12345/postgres', {
        env: { LOCALDRIVE_CONTROL_URL: 'http://127.0.0.1:19876/reset' }
      })).rejects.toThrow('Localdrive reset failed: 500')
    } finally {
      Reflect.deleteProperty(globalThis, 'WebSocketPair')
      Reflect.deleteProperty(globalThis, 'fetch')
    }
  })

  it('resetLocaldriveDatabase uses an explicit controlUrl in Node mode', async () => {
    expect.hasAssertions()

    const controlUrl = 'http://127.0.0.1:19876/reset'
    let requestedUrl: string | undefined

    Reflect.set(globalThis, 'fetch', async (input: RequestInfo | URL): Promise<Response> => {
      requestedUrl = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url

      return new Response(null, { status: 204 })
    })

    try {
      await resetLocaldriveDatabase('postgresql://postgres@127.0.0.1:1/postgres', { controlUrl })

      expect(requestedUrl).toBe(controlUrl)
    } finally {
      Reflect.deleteProperty(globalThis, 'fetch')
    }
  })

  it('resetLocaldriveDatabase throws for unknown Node databases', async () => {
    await expect(resetLocaldriveDatabase('postgresql://postgres@127.0.0.1:1/postgres')).rejects.toThrow('not found')
  })

  it('resetLocaldriveDatabase throws when the control URL is missing in Worker mode', async () => {
    expect.hasAssertions()

    Reflect.set(globalThis, 'WebSocketPair', undefined)
    Reflect.set(globalThis, 'fetch', async (): Promise<Response> => new Response(null, { status: 204 }))

    try {
      await expect(resetLocaldriveDatabase('postgresql://postgres@127.0.0.1:1/postgres'))
        .rejects.toThrow('Localdrive control URL is not configured')
    } finally {
      Reflect.deleteProperty(globalThis, 'WebSocketPair')
      Reflect.deleteProperty(globalThis, 'fetch')
    }
  })
})
