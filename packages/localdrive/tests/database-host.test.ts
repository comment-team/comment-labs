import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { URL } from 'node:url'
import postgres from 'postgres'
import type { MessagePort } from 'node:worker_threads'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createLocaldriveDatabaseSet,
  DatabaseHost,
  defaultDatabaseHostWorkerUrl,
  resolveDatabaseHostWorkerUrl,
  runDatabaseHostWorker
} from '../src/database-host'
import { Localdrive } from '../src/localdrive'
import type { LocaldriveDatabase } from '../src/types'


/**
 * Minimal MessagePort double so the worker-side request handler can be
 * exercised in-process.
 */
class FakePort {
  private handler?: (message: unknown) => void
  readonly sent: unknown[] = []

  // eslint-disable-next-line promise/prefer-await-to-callbacks
  on(event: string, callback: (message: unknown) => void): void {
    if (event === 'message') {
      this.handler = callback
    }
  }

  postMessage(message: unknown): void {
    this.sent.push(message)
  }

  receive(message: unknown): void {
    this.handler?.(message)
  }
}

interface Reply {
  id: number
  ok: boolean
  result?: unknown
  error?: string
}

async function sleep(): Promise<void> {
  // eslint-disable-next-line promise/avoid-new
  await new Promise(resolve => {
    setTimeout(resolve, 20)
  })
}

// eslint-disable-next-line typescript/no-unsafe-type-assertion
const asReply = (message: unknown): Reply | undefined => message as Reply | undefined

async function receiveReply(port: FakePort, id: number): Promise<Reply> {
  for (let attempt = 0; attempt < 500; attempt++) {
    const reply = asReply(port.sent.find(message => asReply(message)?.id === id))

    if (reply !== undefined) {
      return reply
    }

    await sleep()
  }

  throw new Error(`No reply with id ${String(id)} after waiting`)
}

function startFakeHostWorker(): FakePort {
  const port = new FakePort()

  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  runDatabaseHostWorker(port as unknown as MessagePort)

  return port
}

const fixture: {
  controller: Localdrive | undefined
  cwd: string
  templateDump: Uint8Array
} = { controller: undefined, cwd: '', templateDump: new Uint8Array() }

function controller(): Localdrive {
  if (fixture.controller === undefined) {
    throw new Error('fixture not initialized')
  }

  return fixture.controller
}

function templateDump(): Uint8Array {
  return fixture.templateDump
}

function cwd(): string {
  return fixture.cwd
}

function initMessage(id: number, beforeEach?: unknown, dump?: Uint8Array): unknown {
  return {
    id,
    type: 'init',
    bindings: [{ name: 'DB', templateDump: dump ?? templateDump(), beforeEach, cwd: cwd() }]
  }
}

async function expectOkReply(port: FakePort, id: number): Promise<Reply> {
  const reply = await receiveReply(port, id)

  expect(reply.ok).toBeTruthy()

  return reply
}

async function expectErrorReply(port: FakePort, id: number, message: string): Promise<void> {
  const reply = await receiveReply(port, id)

  expect(reply.ok).toBeFalsy()
  expect(reply.error).toContain(message)
}

async function expectItemNames(port: FakePort, id: number, expected: string[]): Promise<void> {
  const reply = await receiveReply(port, id)
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  const result = reply.result as { rows?: { name: string }[] } | undefined

  expect((result?.rows ?? []).map(row => row.name)).toStrictEqual(expected)
}

function initConnectionString(reply: Reply): string {
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  const result = reply.result as { databases?: { name: string; connectionString: string }[] } | undefined

  return (result?.databases ?? []).at(0)?.connectionString ?? ''
}

async function closeHostDatabase(host: DatabaseHost, db: LocaldriveDatabase): Promise<void> {
  await db.close()

  await expect(db.testQuery('SELECT 1')).rejects.toThrow('Unknown database: DB')

  await host.close()
  await host.close()

  await expect(host.reset()).rejects.toThrow('Database host was closed')
}

const postgresUrlPattern = /^postgresql:\/\//u

describe('database host', () => {
  beforeAll(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'localdrive-host-'))

    fixture.cwd = directory
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'schema.sql'), 'CREATE TABLE items (id serial PRIMARY KEY, name text NOT NULL);')
    await writeFile(join(directory, 'snapshot.sql'), 'INSERT INTO items (name) VALUES (\'snapshot\');')
    await writeFile(join(directory, 'before.sql'), 'INSERT INTO items (name) VALUES (\'before-each\');')

    const localdrive = new Localdrive({
      bindings: { DB: { migrations: 'schema.sql', snapshot: 'snapshot.sql', beforeEach: 'before.sql' } },
      cwd: directory
    })

    await localdrive.initialize()

    fixture.controller = localdrive
    fixture.templateDump = await localdrive.getTemplateDataDir('DB')
  }, 120_000)

  afterAll(async () => {
    await controller().close()
    await rm(cwd(), { force: true, recursive: true })
  })

  it('dumps the template once and serves the cached dump afterwards', async () => {
    await expect(controller().getTemplateDataDir('DB')).resolves.toBe(templateDump())

    await expect(controller().getTemplateDataDir('UNKNOWN')).rejects.toThrow('Unknown Localdrive binding')
  })

  it('rejects a null port', () => {
    expect(() => runDatabaseHostWorker(null)).toThrow('must be called inside a worker thread')
  })

  it('serves init, query, reset, and close requests', async () => {
    const port = startFakeHostWorker()

    port.receive(initMessage(1, 'before.sql'))
    expect(initConnectionString(await expectOkReply(port, 1))).toMatch(postgresUrlPattern)

    port.receive({ id: 2, type: 'query', name: 'DB', query: 'INSERT INTO items (name) VALUES (\'test\')', params: [] })
    await expectOkReply(port, 2)

    port.receive({ id: 3, type: 'query', name: 'DB', query: 'SELECT name FROM items ORDER BY id', params: [] })
    await expectItemNames(port, 3, [ 'snapshot', 'before-each', 'test' ])

    port.receive({ id: 4, type: 'reset' })
    await expectOkReply(port, 4)

    port.receive({ id: 5, type: 'query', name: 'DB', query: 'SELECT name FROM items ORDER BY id', params: [] })
    await expectItemNames(port, 5, [ 'snapshot', 'before-each' ])

    port.receive({ id: 6, type: 'close' })
    await expectOkReply(port, 6)

    port.receive({ id: 7, type: 'query', name: 'DB', query: 'SELECT 1', params: [] })
    await expectErrorReply(port, 7, 'Unknown database: DB')
  }, 60_000)

  it('replies with errors for invalid requests', async () => {
    expect.hasAssertions()

    const port = startFakeHostWorker()

    port.receive('garbage')
    await expectErrorReply(port, -1, 'Invalid database host request')

    port.receive({ id: 10, type: 'nonsense' })
    await expectErrorReply(port, 10, 'Unsupported database host request type: nonsense')

    port.receive({ id: 11, type: 'query', name: 'NOPE', query: 'SELECT 1', params: [] })
    await expectErrorReply(port, 11, 'Unknown database: NOPE')

    port.receive({ id: 12, type: 'query', name: 'DB', query: 'SELECT 1', params: 'not-an-array' })
    await expectErrorReply(port, 12, 'Invalid database host query request')
  })

  it('rejects invalid request names and binding shapes', async () => {
    expect.hasAssertions()

    const port = startFakeHostWorker()

    port.receive({ id: 13, type: 'reset', name: 42 })
    await expectErrorReply(port, 13, 'Invalid database name for reset')

    port.receive({ id: 14, type: 'close', name: 42 })
    await expectErrorReply(port, 14, 'Invalid database name for close')

    port.receive({ id: 15, type: 'init', bindings: [] })
    await expectErrorReply(port, 15, 'requires at least one binding')

    port.receive({ id: 16, type: 'init', bindings: [{ name: 'DB', templateDump: 'not-a-dump', beforeEach: undefined, cwd: cwd() }] })
    await expectErrorReply(port, 16, 'Missing template dump for binding: DB')
  })

  it('rejects a second init and works again after a full close', async () => {
    expect.hasAssertions()

    const port = startFakeHostWorker()

    port.receive(initMessage(1, 'before.sql'))
    await expectOkReply(port, 1)

    port.receive(initMessage(2, 'before.sql'))
    await expectErrorReply(port, 2, 'already initialized')

    port.receive({ id: 3, type: 'close' })
    await expectOkReply(port, 3)

    port.receive({ id: 4, type: 'query', name: 'DB', query: 'SELECT 1', params: [] })
    await expectErrorReply(port, 4, 'Unknown database: DB')
  }, 60_000)

  it('cleans up after a failed init so the host can be initialized again', async () => {
    expect.hasAssertions()

    const port = startFakeHostWorker()

    port.receive(initMessage(1, 'missing-*.sql'))
    await expectErrorReply(port, 1, 'SQL glob matched no files')

    port.receive(initMessage(2, 'before.sql'))
    await expectOkReply(port, 2)
  }, 60_000)

  it('rejects invalid binding shapes before restoring any template', async () => {
    expect.hasAssertions()

    const port = startFakeHostWorker()

    port.receive(initMessage(1, 42))
    await expectErrorReply(port, 1, 'Invalid beforeEach SQL source')

    port.receive({ id: 2, type: 'init', bindings: [{ name: 'DB', templateDump: templateDump(), beforeEach: 'before.sql', cwd: 42 }] })
    await expectErrorReply(port, 2, 'Invalid cwd for database host binding')
  })

  it('creates databases on a real host thread and keeps reset semantics over the wire protocol', async () => {
    const host = new DatabaseHost({ workerUrl: defaultDatabaseHostWorkerUrl(), rpcTimeoutMs: 60_000 })

    const databases = await host.createDatabases([
      {
        name: 'DB',
        getTemplateDataDir: async () => await controller().getTemplateDataDir('DB'),
        beforeEach: 'before.sql',
        cwd: cwd()
      }
    ])

    const db = databases.DB

    if (db === undefined) {
      throw new Error('Missing DB binding')
    }

    // Extension functions from the core-built template must survive the
    // data-dir transfer into the host thread.
    await expect(db.testQuery('SELECT similarity(\'local\', \'locale\') AS score')).resolves.toHaveLength(1)

    // A real PostgreSQL client reaches the host thread over the socket.
    const sql = postgres(db.connectionString, { max: 1 })
    const inserted = await sql`INSERT INTO items (name) VALUES ('from-postgres') RETURNING name`

    expect(inserted.at(0)?.name).toBe('from-postgres')

    const baseline = db.connectionString

    await db.reset()

    expect(db.connectionString).toBe(baseline)
    await expect(db.testQuery<{ name: string }>('SELECT name FROM items ORDER BY id')).resolves.toStrictEqual([
      { name: 'snapshot' },
      { name: 'before-each' }
    ])

    await sql.end()
    await closeHostDatabase(host, db)
  }, 120_000)

  it('times out requests and surfaces worker deaths', async () => {
    const host = new DatabaseHost({ workerUrl: defaultDatabaseHostWorkerUrl(), rpcTimeoutMs: 1 })

    await expect(host.createDatabases([
      {
        name: 'DB',
        getTemplateDataDir: async () => await controller().getTemplateDataDir('DB'),
        beforeEach: 'before.sql',
        cwd: cwd()
      }
    ])).rejects.toThrow('timed out after 1ms: init')

    // The host stays usable after a timeout; closing terminates the worker.
    await host.close()

    const broken = new DatabaseHost({
      workerUrl: new URL('definitely-missing-worker.mjs', import.meta.url),
      rpcTimeoutMs: 60_000
    })

    await expect(broken.createDatabases([
      {
        name: 'DB',
        getTemplateDataDir: async () => await controller().getTemplateDataDir('DB'),
        beforeEach: 'before.sql',
        cwd: cwd()
      }
    ])).rejects.toThrow('Database host worker')

    await expect(broken.reset()).rejects.toThrow('Database host was closed')
  }, 60_000)

  it('creates a working inline set and threaded set from the same controller', async () => {
    const databaseSetOptions = {
      bindings: { DB: { migrations: 'schema.sql', snapshot: 'snapshot.sql', beforeEach: 'before.sql' } },
      databaseHostRpcTimeoutMs: 60_000
    }

    const inline = await createLocaldriveDatabaseSet(controller(), { ...databaseSetOptions, databaseHost: 'inline' })
    const inlineDb = inline.databases.DB

    if (inlineDb === undefined) {
      throw new Error('Missing inline DB binding')
    }

    expect(inline.connectionStrings.DB).toMatch(postgresUrlPattern)
    await inlineDb.testQuery('INSERT INTO items (name) VALUES (\'inline-mutation\')')
    await inline.resetAll()
    await expect(inlineDb.testQuery<{ name: string }>('SELECT name FROM items ORDER BY id')).resolves.toStrictEqual([
      { name: 'snapshot' },
      { name: 'before-each' }
    ])

    await inline.close()

    const threaded = await createLocaldriveDatabaseSet(controller(), { ...databaseSetOptions, databaseHost: 'thread' })
    const threadedDb = threaded.databases.DB

    if (threadedDb === undefined) {
      throw new Error('Missing threaded DB binding')
    }

    expect(threaded.connectionStrings.DB).toMatch(postgresUrlPattern)
    await threadedDb.testQuery('INSERT INTO items (name) VALUES (\'threaded-mutation\')')
    await threaded.resetAll()
    await expect(threadedDb.testQuery<{ name: string }>('SELECT name FROM items ORDER BY id')).resolves.toStrictEqual([
      { name: 'snapshot' },
      { name: 'before-each' }
    ])

    await threaded.close()
  }, 120_000)

  it('throws when the worker file cannot be resolved', () => {
    expect(() => resolveDatabaseHostWorkerUrl([
      new URL('missing-one.mjs', import.meta.url),
      new URL('missing-two.mjs', import.meta.url)
    ])).toThrow('[localdrive]')
  })
})
