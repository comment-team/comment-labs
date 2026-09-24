/* eslint-disable max-classes-per-file */
import { existsSync } from 'node:fs'
import { URL } from 'node:url'
import {
  Worker,
  type MessagePort,
  type ResourceLimits as WorkerResourceLimits,
  type WorkerOptions
} from 'node:worker_threads'
import { PGlite } from '@electric-sql/pglite'
import { createTestDatabase, localdriveExtensions, type Localdrive } from './localdrive'
import type { LocaldriveBindingOptions, LocaldriveDatabase, SqlSource } from './types'


/**
 * A binding the database host worker thread should restore and serve.
 */
export interface DatabaseHostInitBinding {
  readonly name: string
  readonly templateDump: Uint8Array
  readonly beforeEach: SqlSource | undefined
  readonly cwd: string
}

export type DatabaseHostRequest
  = | { readonly id: number; readonly type: 'init'; readonly bindings: readonly DatabaseHostInitBinding[] }
    | { readonly id: number; readonly type: 'reset'; readonly name?: string }
    | { readonly id: number; readonly type: 'query'; readonly name: string; readonly query: string; readonly params: unknown[] }
    | { readonly id: number; readonly type: 'close'; readonly name?: string }

export interface DatabaseHostInitResult {
  readonly type: 'init'
  readonly databases: ReadonlyArray<{ readonly name: string; readonly connectionString: string }>
}

export interface DatabaseHostResetResult {
  readonly type: 'reset'
}

export interface DatabaseHostQueryResult {
  readonly type: 'query'
  readonly rows: Record<string, unknown>[]
}

export interface DatabaseHostCloseResult {
  readonly type: 'close'
}

export type DatabaseHostResult
  = DatabaseHostInitResult
  | DatabaseHostResetResult
  | DatabaseHostQueryResult
  | DatabaseHostCloseResult

export type DatabaseHostResponse
  = | { readonly id: number; readonly ok: true; readonly result: DatabaseHostResult }
    | { readonly id: number; readonly ok: false; readonly error: string }

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never

type DatabaseHostRequestPayload = DistributiveOmit<DatabaseHostRequest, 'id'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function getRequestId(message: unknown): number {
  if (isRecord(message) && typeof message.id === 'number') {
    return message.id
  }

  return -1
}

function getBeforeEach(source: unknown): SqlSource | undefined {
  if (source === undefined) {
    return undefined
  }

  if (typeof source !== 'string' && !(Array.isArray(source) && source.every(entry => typeof entry === 'string'))) {
    throw new TypeError('Invalid beforeEach SQL source')
  }

  return source
}

function getCwd(source: unknown): string {
  if (typeof source !== 'string') {
    throw new TypeError('Invalid cwd for database host binding')
  }

  return source
}

/**
 * The worker-thread half of the database host. Restores template PGlite
 * instances from transferred data-dir dumps and serves per-binding database
 * clones over loopback PostgreSQL sockets, so that neither the template
 * clones nor the SQL executed against them ever touch the Vitest core
 * thread.
 */
export function runDatabaseHostWorker(port: MessagePort | null): void {
  if (port === null) {
    throw new Error('runDatabaseHostWorker must be called inside a worker thread')
  }

  const channel = port
  const templates = new Map<string, PGlite>()
  const databases = new Map<string, LocaldriveDatabase>()

  channel.on('message', message => {
    // eslint-disable-next-line promise/prefer-await-to-then
    handleRequest(message).catch(() => {
      // The reply itself failed to serialize; nothing more we can do.
    })
  })

  async function handleRequest(message: unknown): Promise<void> {
    const id = getRequestId(message)

    try {
      const result = await dispatch(message)

      // eslint-disable-next-line unicorn/require-post-message-target-origin
      channel.postMessage({ id, ok: true, result } satisfies DatabaseHostResponse)
    } catch (error) {
      // eslint-disable-next-line unicorn/require-post-message-target-origin
      channel.postMessage({ id, ok: false, error: errorMessage(error) } satisfies DatabaseHostResponse)
    }
  }

  async function dispatch(message: unknown): Promise<DatabaseHostResult> {
    if (!isRecord(message) || typeof message.type !== 'string') {
      throw new TypeError('Invalid database host request')
    }

    switch (message.type) {
      case 'init':
        return await init(message.bindings)

      case 'reset':
        return await reset(message.name)

      case 'query':
        return await query(message.name, message.query, message.params)

      case 'close':
        return await close(message.name)

      default:
        throw new Error(`Unsupported database host request type: ${message.type}`)
    }
  }

  async function init(bindings: unknown): Promise<DatabaseHostInitResult> {
    if (databases.size > 0 || templates.size > 0) {
      throw new Error('Database host worker is already initialized')
    }

    if (!Array.isArray(bindings) || bindings.length === 0) {
      throw new TypeError('Database host init requires at least one binding')
    }

    const created: { name: string; database: LocaldriveDatabase }[] = []

    try {
      // Validate every binding shape before spending time on restores.
      const validated = bindings.map(binding => {
        if (!isRecord(binding) || typeof binding.name !== 'string') {
          throw new TypeError('Invalid database host binding')
        }

        if (!(binding.templateDump instanceof Uint8Array)) {
          throw new TypeError(`Missing template dump for binding: ${binding.name}`)
        }

        return {
          name: binding.name,
          templateDump: binding.templateDump,
          beforeEach: getBeforeEach(binding.beforeEach),
          cwd: getCwd(binding.cwd)
        }
      })

      for (const binding of validated) {
        const template = await PGlite.create({
          extensions: localdriveExtensions,
          loadDataDir: new Blob([ binding.templateDump ])
        })

        templates.set(binding.name, template)
      }

      await Promise.all(validated.map(async binding => {
        const template = templates.get(binding.name)

        if (template === undefined) {
          throw new Error(`Missing restored template for binding: ${binding.name}`)
        }

        const database = await createTestDatabase(template, { beforeEach: binding.beforeEach }, binding.cwd)

        databases.set(binding.name, database)
        created.push({ name: binding.name, database })
      }))

      return {
        type: 'init',
        databases: created.map(({ name, database }) => ({ name, connectionString: database.connectionString }))
      }
    } catch (error) {
      await closeAll()

      throw error
    }
  }

  async function reset(name: unknown): Promise<DatabaseHostResetResult> {
    if (typeof name === 'string') {
      const database = getDatabase(name)

      await database.reset()

      return { type: 'reset' }
    }

    if (name !== undefined) {
      throw new TypeError('Invalid database name for reset')
    }

    await Promise.all(Array.from(databases.values(), async database => await database.reset()))

    return { type: 'reset' }
  }

  async function query(name: unknown, queryText: unknown, params: unknown): Promise<DatabaseHostQueryResult> {
    if (typeof name !== 'string' || typeof queryText !== 'string' || (params !== undefined && !Array.isArray(params))) {
      throw new TypeError('Invalid database host query request')
    }

    const database = getDatabase(name)

    // The rows are plain query results: structured-clone-safe data only.
    const rows = await database.testQuery(queryText, params ?? [])

    return { type: 'query', rows }
  }

  async function close(name: unknown): Promise<DatabaseHostCloseResult> {
    if (typeof name === 'string') {
      const database = getDatabase(name)

      databases.delete(name)
      await database.close()

      return { type: 'close' }
    }

    if (name !== undefined) {
      throw new TypeError('Invalid database name for close')
    }

    await closeAll()

    return { type: 'close' }
  }

  function getDatabase(name: string): LocaldriveDatabase {
    const database = databases.get(name)

    if (database === undefined) {
      throw new Error(`Unknown database: ${name}`)
    }

    return database
  }

  async function closeAll(): Promise<void> {
    const openDatabases = databases.values().toArray()
    const openTemplates = templates.values().toArray()

    databases.clear()
    templates.clear()

    await Promise.all(openDatabases.map(async database => await database.close()))

    for (const template of openTemplates) {
      await template.close()
    }
  }
}

interface DatabaseHostWorkerLike {
  postMessage: (message: unknown) => void
  on: (event: 'message' | 'error' | 'exit', callback: (argument: unknown) => void) => void
  terminate: () => Promise<number>
}

export interface DatabaseHostOptions {
  readonly workerUrl: URL
  readonly resourceLimits?: WorkerResourceLimits
  readonly rpcTimeoutMs: number
}

interface PendingRpc {
  resolve: (result: DatabaseHostResult) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

class HostedDatabase implements LocaldriveDatabase {
  constructor(
    private readonly host: DatabaseHost,
    readonly name: string,
    readonly connectionString: string
  ) {}

  async testQuery<T extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    params: unknown[] = []
  ): Promise<T[]> {
    return await this.host.queryDatabase<T>(this.name, query, params)
  }

  async reset(): Promise<void> {
    await this.host.reset(this.name)
  }

  async close(): Promise<void> {
    await this.host.closeDatabase(this.name)
  }
}

/**
 * The core-thread half of the database host: owns the worker thread, turns
 * RPCs into promises, and surfaces worker failures and RPC timeouts as
 * rejections so callers can never hang waiting for a database that died.
 */
export class DatabaseHost {
  private worker?: DatabaseHostWorkerLike
  private readonly pending = new Map<number, PendingRpc>()
  private nextRequestId = 0
  private closed = false

  constructor(private readonly options: DatabaseHostOptions) {}

  async createDatabases(
    bindings: ReadonlyArray<{
      readonly name: string
      readonly getTemplateDataDir: () => Promise<Uint8Array>
      readonly beforeEach: SqlSource | undefined
      readonly cwd: string
    }>
  ): Promise<Record<string, LocaldriveDatabase>> {
    const initBindings = await Promise.all(bindings.map(async binding => {
      const templateDump = await binding.getTemplateDataDir()

      return {
        name: binding.name,
        templateDump,
        beforeEach: binding.beforeEach,
        cwd: binding.cwd
      } satisfies DatabaseHostInitBinding
    }))

    const result = await this.request({ type: 'init', bindings: initBindings })

    if (result.type !== 'init') {
      throw new Error('Database host returned an unexpected response for init')
    }

    return Object.fromEntries(
      result.databases.map(({ name, connectionString }) => [ name, new HostedDatabase(this, name, connectionString) ])
    )
  }

  async reset(name?: string): Promise<void> {
    await this.request({ type: 'reset', name })
  }

  async queryDatabase<T extends Record<string, unknown> = Record<string, unknown>>(
    name: string,
    query: string,
    params: unknown[] = []
  ): Promise<T[]> {
    const result = await this.request({ type: 'query', name, query, params })

    if (result.type !== 'query') {
      throw new Error('Database host returned an unexpected response for query')
    }

    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    return result.rows as T[]
  }

  async closeDatabase(name: string): Promise<void> {
    await this.request({ type: 'close', name })
  }

  async close(): Promise<void> {
    if (this.closed) {
      return
    }

    this.closed = true

    const worker = this.worker
    this.worker = undefined
    rejectPending(this.pending, new Error('Database host was closed'))

    if (worker === undefined) {
      return
    }

    try {
      await worker.terminate()
    } catch {
      // The worker may already be gone; termination is best-effort.
    }
  }

  private async request(requestWithoutId: DatabaseHostRequestPayload): Promise<DatabaseHostResult> {
    const worker = this.ensureWorker()
    const id = ++this.nextRequestId
    const { rpcTimeoutMs } = this.options

    // eslint-disable-next-line promise/avoid-new
    return await new Promise<DatabaseHostResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Database host request timed out after ${String(rpcTimeoutMs)}ms: ${requestWithoutId.type}`))
      }, rpcTimeoutMs)

      this.pending.set(id, { resolve, reject, timeout })
      // eslint-disable-next-line unicorn/require-post-message-target-origin
      worker.postMessage({ ...requestWithoutId, id } satisfies DatabaseHostRequest)
    })
  }

  private ensureWorker(): DatabaseHostWorkerLike {
    if (this.closed) {
      throw new Error('Database host was closed')
    }

    if (this.worker !== undefined) {
      return this.worker
    }

    // `type: 'module'` is still accepted at runtime on Node versions that
    // require it for ESM workers, but newer @types/node no longer declares it.
    const worker = new Worker(this.options.workerUrl, {
      type: 'module',
      resourceLimits: this.options.resourceLimits
    } as WorkerOptions)

    worker.on('message', message => {
      this.handleResponse(message)
    })
    worker.on('error', error => {
      this.handleWorkerFailure(new Error('Database host worker crashed', { cause: error }))
    })
    worker.on('exit', () => {
      this.handleWorkerFailure(new Error('Database host worker exited unexpectedly'))
    })

    this.worker = worker

    return worker
  }

  private handleResponse(message: unknown): void {
    if (!isRecord(message) || typeof message.id !== 'number') {
      return
    }

    const pending = this.pending.get(message.id)

    if (pending === undefined) {
      return
    }

    this.pending.delete(message.id)
    clearTimeout(pending.timeout)

    if (message.ok === true && isRecord(message.result)) {
      // eslint-disable-next-line typescript/no-unsafe-type-assertion
      pending.resolve(message.result as unknown as DatabaseHostResult)

      return
    }

    pending.reject(new Error(typeof message.error === 'string' ? message.error : 'Database host request failed'))
  }

  /**
   * Marks the host unusable and rejects every pending request. A worker that
   * errors or exits terminates itself, so no cleanup is needed here; the
   * `exit` event firing after `error` makes this idempotent.
   */
  private handleWorkerFailure(error: Error): void {
    this.worker = undefined
    this.closed = true
    rejectPending(this.pending, error)
  }
}

function rejectPending(pending: Map<number, PendingRpc>, error: Error): void {
  for (const entry of pending.values()) {
    clearTimeout(entry.timeout)
    entry.reject(error)
  }

  pending.clear()
}

/**
 * Returns the first candidate that exists on disk. The candidates are
 * ordered so the published layout (the worker file sits next to this
 * module inside `dist/`) wins, with the repo's built `dist/` as the
 * fallback for running the tests straight from `src/`.
 */
export function resolveDatabaseHostWorkerUrl(candidates: readonly URL[]): URL {
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  throw new Error(
    '[localdrive] The database host worker file was not found. Build @comment-labs/localdrive (pnpm build) or set databaseHost: "inline".'
  )
}

export function defaultDatabaseHostWorkerUrl(): URL {
  return resolveDatabaseHostWorkerUrl([
    new URL('database-host-worker.mjs', import.meta.url),
    new URL('../dist/database-host-worker.mjs', import.meta.url)
  ])
}

/**
 * The databases a single pool worker owns, independent of where the PGlite
 * instances actually run. `resetAll` must leave every database in the same
 * state as a fresh `createTestDatabases()` call.
 */
export interface DatabaseSet {
  readonly connectionStrings: Record<string, string>
  readonly databases: Record<string, LocaldriveDatabase>
  resetAll: () => Promise<void>
  close: () => Promise<void>
}

export interface DatabaseSetOptions {
  readonly bindings: Record<string, LocaldriveBindingOptions>
  readonly databaseHost: 'thread' | 'inline'
  readonly databaseHostResourceLimits?: WorkerResourceLimits
  readonly databaseHostRpcTimeoutMs: number
}

/**
 * Creates the databases owned by one pool worker: on a dedicated host
 * thread (default) or inline on the core thread.
 */
export async function createLocaldriveDatabaseSet(
  controller: Localdrive,
  options: DatabaseSetOptions
): Promise<DatabaseSet> {
  if (options.databaseHost === 'inline') {
    return await createInlineDatabaseSet(controller)
  }

  return await createThreadedDatabaseSet(controller, options)
}

async function createInlineDatabaseSet(controller: Localdrive): Promise<DatabaseSet> {
  const databases = await controller.createTestDatabases()

  return {
    connectionStrings: Object.fromEntries(
      Object.entries(databases).map(([ name, database ]) => [ name, database.connectionString ])
    ),
    databases,
    resetAll: async (): Promise<void> => {
      await Promise.all(Object.values(databases).map(async database => await database.reset()))
    },
    close: async (): Promise<void> => {
      await Promise.all(Object.values(databases).map(async database => await database.close()))
    }
  }
}

async function createThreadedDatabaseSet(
  controller: Localdrive,
  options: DatabaseSetOptions
): Promise<DatabaseSet> {
  const host = new DatabaseHost({
    workerUrl: defaultDatabaseHostWorkerUrl(),
    resourceLimits: options.databaseHostResourceLimits,
    rpcTimeoutMs: options.databaseHostRpcTimeoutMs
  })

  try {
    const databases = await host.createDatabases(
      Object.entries(options.bindings).map(([ name, binding ]) => ({
        name,
        getTemplateDataDir: async (): Promise<Uint8Array> => await controller.getTemplateDataDir(name),
        beforeEach: binding.beforeEach,
        cwd: controller.cwd
      }))
    )

    return {
      connectionStrings: Object.fromEntries(
        Object.entries(databases).map(([ name, database ]) => [ name, database.connectionString ])
      ),
      databases,
      resetAll: async (): Promise<void> => {
        await host.reset()
      },
      close: async (): Promise<void> => {
        await host.close()
      }
    }
  } catch (error) {
    try {
      await host.close()
    } catch {
      // The host may already be dead; closing is best-effort.
    }

    throw error
  }
}
