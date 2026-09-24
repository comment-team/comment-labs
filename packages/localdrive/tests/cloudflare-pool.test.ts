import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { PoolOptions, PoolTask, PoolWorker, WorkerRequest } from 'vitest/node'
import type { Localdrive } from '../src/localdrive'
import type { LocaldriveDatabase } from '../src/types'


interface InnerWorker extends PoolWorker {
  start: Mock<() => Promise<void>>
  stop: Mock<() => Promise<void>>
  send: Mock<(message: WorkerRequest) => void>
  deserialize: Mock<(data: unknown) => unknown>
  emitMessage: (message: unknown) => void
  emitError: (error: unknown) => void
  emitExit: () => void
}

const innerWorkers: InnerWorker[] = []

function createInnerWorker(): InnerWorker {
  const listeners: Record<string, Array<(argument?: unknown) => void>> = {}

  return {
    name: 'cloudflare-pool',
    cacheFs: false,
    start: vi.fn<() => Promise<void>>(),
    stop: vi.fn<() => Promise<void>>(),
    send: vi.fn<(message: WorkerRequest) => void>(),
    // The EventEmitter-style listener registry mirrors what the real inner
    // pool worker does with vitest's event callbacks.
    // eslint-disable-next-line promise/prefer-await-to-callbacks
    on: vi.fn<(event: string, callback: (argument?: unknown) => void) => void>((event, callback) => {
      (listeners[event] ??= []).push(callback)
    }),
    off: vi.fn<() => void>(),
    deserialize: vi.fn<(data: unknown) => unknown>(data => data),
    emitMessage: (message: unknown): void => {
      for (const listener of listeners.message ?? []) {
        listener(message)
      }
    },
    emitError: (error: unknown): void => {
      for (const listener of listeners.error ?? []) {
        listener(error)
      }
    },
    emitExit: (): void => {
      for (const listener of listeners.exit ?? []) {
        listener()
      }
    }
  }
}

const cloudflarePoolMock = vi.fn<(options: unknown) => { createPoolWorker: () => InnerWorker }>(() => ({
  createPoolWorker: (): InnerWorker => {
    const worker = createInnerWorker()

    innerWorkers.push(worker)

    return worker
  }
}))

// eslint-disable-next-line vitest/prefer-import-in-mock
vi.mock('@cloudflare/vitest-plugin', () => ({ cloudflarePool: cloudflarePoolMock }))

const { closeActiveDatabases, localdriveCloudflarePool } = await import('../src/cloudflare-pool')
const { registerLocaldrive, unregisterLocaldrive } = await import('../src/registry')

const projectName = 'cloudflare-pool-test-project'
const fakeConnectionString = 'postgresql://postgres:password@127.0.0.1:54321/postgres?application_name=test'

// eslint-disable-next-line typescript/no-unsafe-type-assertion
const poolOptions = { project: { name: projectName } } as unknown as PoolOptions

function asLocaldrive(value: {
  cwd: string
  controlServer: undefined
  controlUrl: undefined
  initialize: Mock<() => Promise<void>>
  createTestDatabases: Mock<() => Promise<Record<string, LocaldriveDatabase>>>
  getTemplateDataDir: Mock<() => Promise<Uint8Array>>
  reset: Mock<() => Promise<void>>
  close: Mock<() => Promise<void>>
}): Localdrive {
  // Localdrive has private members, so the pool worker only relies on the
  // public controller surface of this test double.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return value as unknown as Localdrive
}

function createPoolWorker(workerReuse: boolean): PoolWorker {
  const initializer = localdriveCloudflarePool({
    bindings: { DB: { beforeEach: 'before.sql' } },
    cloudflare: { main: './tests/cloudflare/src/index.ts' },
    workerReuse,
    databaseHost: 'inline'
  })

  return initializer.createPoolWorker(poolOptions)
}

function request(message: Record<string, unknown>): WorkerRequest {
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return message as unknown as WorkerRequest
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null) {
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    return value as unknown as Record<string, unknown>
  }

  return undefined
}

function findTestfileFinished(messages: unknown[]): { error?: unknown } {
  for (const message of messages) {
    const record = asRecord(message)

    if (record?.type === 'testfileFinished') {
      return record
    }
  }

  throw new Error('testfileFinished response was not emitted')
}

async function waitForTrue(condition: () => boolean): Promise<void> {
  await vi.waitFor(() => {
    if (!condition()) {
      throw new Error('condition not met yet')
    }
  })
}

async function waitForInnerSend(inner: InnerWorker, calls: number): Promise<void> {
  await waitForTrue(() => inner.send.mock.calls.length >= calls)
}

async function initializeWorker(worker: PoolWorker, filepath = 'a.test.ts'): Promise<InnerWorker> {
  const before = innerWorkers.length

  worker.send(request({ type: 'start' }))
  worker.send(request({ type: 'run', context: { files: [{ filepath }] } }))

  await waitForTrue(() => innerWorkers.length === before + 1)

  const inner = innerWorkers.at(-1)

  if (inner === undefined) {
    throw new Error('Missing inner worker')
  }

  await waitForInnerSend(inner, 2)

  return inner
}

function collectMessages(worker: PoolWorker): unknown[] {
  const messages: unknown[] = []

  worker.on('message', message => {
    messages.push(message)
  })

  return messages
}

function collectErrors(worker: PoolWorker): unknown[] {
  const errors: unknown[] = []

  worker.on('error', error => {
    errors.push(error)
  })

  return errors
}

function expectStartedResponse(messages: unknown[]): void {
  expect(messages).toStrictEqual([{ __vitest_worker_response__: true, type: 'started' }])
}

const controlUrlPattern = /^http:\/\/127\.0\.0\.1:\d+\/reset$/u

function expectFreshDatabaseWiring(): void {
  const firstCallArguments = cloudflarePoolMock.mock.calls.at(0)
  const options = asRecord(firstCallArguments?.at(0))
  const miniflare = asRecord(options?.miniflare)
  const hyperdrives = asRecord(miniflare?.hyperdrives)
  const bindings = asRecord(miniflare?.bindings)

  expect(hyperdrives?.DB).toBe(fakeConnectionString)
  expect(String(bindings?.LOCALDRIVE_CONTROL_URL)).toMatch(controlUrlPattern)
}

describe('localdriveCloudflarePool', () => {
  let controller: Localdrive
  let createTestDatabases: Mock<() => Promise<Record<string, LocaldriveDatabase>>>
  let resetDatabase: Mock<() => Promise<void>>
  let closeDatabase: Mock<() => Promise<void>>

  beforeEach(() => {
    innerWorkers.length = 0
    cloudflarePoolMock.mockClear()

    resetDatabase = vi.fn<() => Promise<void>>()
    closeDatabase = vi.fn<() => Promise<void>>()

    const fakeDatabase: LocaldriveDatabase = {
      connectionString: fakeConnectionString,
      // eslint-disable-next-line typescript/no-unsafe-type-assertion
      testQuery: vi.fn<LocaldriveDatabase['testQuery']>() as unknown as LocaldriveDatabase['testQuery'],
      reset: resetDatabase,
      close: closeDatabase
    }

    createTestDatabases = vi.fn<() => Promise<Record<string, LocaldriveDatabase>>>()
    createTestDatabases.mockResolvedValue({ DB: fakeDatabase })

    controller = asLocaldrive({
      cwd: '/fake/cwd',
      controlServer: undefined,
      controlUrl: undefined,
      initialize: vi.fn<() => Promise<void>>(),
      createTestDatabases,
      getTemplateDataDir: vi.fn<() => Promise<Uint8Array>>(),
      reset: vi.fn<() => Promise<void>>(),
      close: vi.fn<() => Promise<void>>()
    })

    registerLocaldrive(projectName, controller)
  })

  afterEach(async () => {
    unregisterLocaldrive(projectName)
    await closeActiveDatabases()
  })

  it('reuses the pool worker for non-isolated tasks by default and opts out with workerReuse: false', () => {
    const reusing = createPoolWorker(true)
    const isolation = createPoolWorker(false)

    /* eslint-disable typescript/no-unsafe-type-assertion */
    const isolatedTask = { isolate: true } as unknown as PoolTask
    const sharedTask = { isolate: false } as unknown as PoolTask
    /* eslint-enable typescript/no-unsafe-type-assertion */

    expect(reusing.canReuse?.(isolatedTask)).toBeFalsy()
    expect(reusing.canReuse?.(sharedTask)).toBeTruthy()
    expect(isolation.canReuse?.(sharedTask)).toBeFalsy()
  })

  it('answers the start message immediately and initializes lazily on the first work message', async () => {
    const worker = createPoolWorker(true)
    const messages = collectMessages(worker)
    const errors = collectErrors(worker)
    const start = request({ type: 'start' })

    worker.send(start)
    expectStartedResponse(messages)
    expect(innerWorkers).toHaveLength(0)

    worker.send(request({ type: 'run', context: { files: [{ filepath: 'a.test.ts' }] } }))

    const inner = await initializeWorker(worker)

    expect(inner.send).toHaveBeenNthCalledWith(1, start)
    expect(inner.send).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: 'run' }))
    expectFreshDatabaseWiring()
    expect(errors).toStrictEqual([])
  })

  it('resets the databases between files instead of re-initializing the inner worker', async () => {
    const worker = createPoolWorker(true)
    const firstInner = await initializeWorker(worker)

    worker.send(request({ type: 'collect', context: { files: [{ filepath: 'b.test.ts' }] } }))

    await waitForInnerSend(firstInner, 3)

    // No new workerd, no new databases: exactly one reset before the second
    // work message was forwarded.
    expect(innerWorkers).toHaveLength(1)
    expect(createTestDatabases).toHaveBeenCalledOnce()
    expect(firstInner.send).toHaveBeenNthCalledWith(3, expect.objectContaining({ type: 'collect' }))

    // The reset must complete before the work message is forwarded.
    expect(resetDatabase).toHaveBeenCalledOnce()
    expect(resetDatabase.mock.invocationCallOrder[0] ?? -1).toBeLessThan(
      firstInner.send.mock.invocationCallOrder[2] ?? -1
    )
  })

  it('re-initializes after a failed file so a reused runner keeps working', async () => {
    const worker = createPoolWorker(true)
    const messages = collectMessages(worker)
    const errors = collectErrors(worker)

    const firstInner = await initializeWorker(worker)

    const resetError = new Error('reset exploded')

    createTestDatabases.mockClear()
    closeDatabase.mockClear()
    resetDatabase.mockRejectedValueOnce(resetError)

    worker.send(request({ type: 'run', context: { files: [{ filepath: 'b.test.ts' }] } }))

    await waitForTrue(() => errors.length > 0)

    expect(errors).toStrictEqual([ resetError ])
    expect(findTestfileFinished(messages).error).toBe(resetError)

    // The failed worker tore down its inner worker and databases.
    await waitForTrue(() => closeDatabase.mock.calls.length > 0 && firstInner.stop.mock.calls.length > 0)

    // The next file on the reused runner starts from scratch: fresh
    // databases, a fresh inner worker, and the start message replayed again.
    worker.send(request({ type: 'run', context: { files: [{ filepath: 'c.test.ts' }] } }))

    const secondInner = await initializeWorker(worker, 'c.test.ts')

    expect(createTestDatabases).toHaveBeenCalledOnce()
    expect(secondInner.send).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: 'start' }))
  })

  it('reports missing controllers as file errors and recovers when the controller appears', async () => {
    const worker = createPoolWorker(true)
    const messages = collectMessages(worker)
    const errors = collectErrors(worker)

    unregisterLocaldrive(projectName)

    worker.send(request({ type: 'start' }))
    worker.send(request({ type: 'run', context: { files: [{ filepath: 'a.test.ts' }] } }))

    await waitForTrue(() => errors.length > 0)

    const firstError = asRecord(errors.at(0))

    expect(String(firstError?.message)).toContain('Localdrive controller was not provided')
    expect(findTestfileFinished(messages).error).toBe(errors.at(0))
    expect(innerWorkers).toHaveLength(0)

    registerLocaldrive(projectName, controller)

    await initializeWorker(worker)

    expect(errors).toHaveLength(1)
  })

  it('filters the inner started echo and forwards everything else', async () => {
    const worker = createPoolWorker(true)
    const messages = collectMessages(worker)
    const exits: unknown[] = []

    worker.on('exit', () => {
      exits.push('exit')
    })

    const inner = await initializeWorker(worker)

    inner.emitMessage({ __vitest_worker_response__: true, type: 'started' })
    inner.emitMessage({ __vitest_worker_response__: true, type: 'testfileFinished', files: [] })
    inner.emitError(new Error('inner exploded'))
    inner.emitExit()

    expect(messages).toStrictEqual([
      { __vitest_worker_response__: true, type: 'started' },
      { __vitest_worker_response__: true, type: 'testfileFinished', files: [] }
    ])
    expect(exits).toStrictEqual([ 'exit' ])
    expect(worker.deserialize({ result: 1 })).toStrictEqual({ result: 1 })
  })

  it('answers stop messages and tears everything down on worker stop', async () => {
    const worker = createPoolWorker(true)
    const messages = collectMessages(worker)

    worker.send(request({ type: 'start' }))

    // Stop before initialization: answered locally, inner still missing.
    worker.send(request({ type: 'stop' }))

    await waitForTrue(() => messages.length >= 2)

    expect(messages).toStrictEqual([
      { __vitest_worker_response__: true, type: 'started' },
      { __vitest_worker_response__: true, type: 'stopped' }
    ])

    const inner = await initializeWorker(worker)
    const stop = request({ type: 'stop' })

    worker.send(stop)

    await waitForTrue(() => inner.send.mock.calls.length >= 3)

    expect(inner.send).toHaveBeenNthCalledWith(3, stop)

    const cancel = request({ type: 'cancel' })

    worker.send(cancel)

    await waitForTrue(() => inner.send.mock.calls.length >= 4)

    expect(inner.send).toHaveBeenNthCalledWith(4, cancel)

    await worker.stop()

    expect(inner.stop).toHaveBeenCalledOnce()
    expect(closeDatabase).toHaveBeenCalledOnce()
  })
})
