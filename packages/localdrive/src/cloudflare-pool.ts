import { cloudflarePool } from '@cloudflare/vitest-plugin'
import type { PoolOptions, PoolRunnerInitializer, PoolTask, PoolWorker, WorkerRequest } from 'vitest/node'
import { startControlServer, type LocaldriveControlServer } from './control-server'
import {
  createLocaldriveDatabaseSet,
  type DatabaseSet,
  type DatabaseSetOptions
} from './database-host'
import { getLocaldrive } from './registry'
import type { LocaldriveCloudflareTestOptions, LocaldriveDatabase } from './types'


type CloudflarePoolOptions = Parameters<typeof cloudflarePool>[0]
type CloudflarePoolFunction = Extract<CloudflarePoolOptions, (...args: never[]) => unknown>
type ResolvedCloudflarePoolOptions = Awaited<ReturnType<CloudflarePoolFunction>>

type WorkRequest = Extract<WorkerRequest, { type: 'run' | 'collect' }>

interface ResolvedLocaldrivePoolOptions extends DatabaseSetOptions {
  readonly workerReuse: boolean
  readonly cloudflare: LocaldriveCloudflareTestOptions['cloudflare']
}

const activeDatabases = new Set<LocaldriveDatabase>()

export async function closeActiveDatabases(): Promise<void> {
  const databases = [ ...activeDatabases ]
  activeDatabases.clear()

  await Promise.all(databases.map(async database => await database.close()))
}

function isStartedMessage(message: unknown): boolean {
  return typeof message === 'object'
    && message !== null
    && '__vitest_worker_response__' in message
    && (message as Record<string, unknown>).type === 'started'
}

class LocaldriveCloudflarePoolWorker implements PoolWorker {
  readonly name = 'localdrive-cloudflare-pool'
  readonly cacheFs = false

  private messageCallback?: (message: unknown) => void
  private errorCallback?: (error: unknown) => void
  private exitCallback?: () => void
  private inner?: PoolWorker
  private databases?: DatabaseSet
  private controlServer?: LocaldriveControlServer
  private startMessage?: WorkerRequest
  private initialized = false
  private packedFilesWarningShown = false
  private work: Promise<void> = Promise.resolve()

  constructor(
    private readonly options: PoolOptions,
    private readonly localdriveOptions: ResolvedLocaldrivePoolOptions
  ) {}

  async start(): Promise<void> {
    // The actual Cloudflare worker is started lazily when the first run/collect
    // request arrives, because only then do we know which test file is being
    // executed and which database clone it needs.
  }

  send(message: WorkerRequest): void {
    switch (message.type) {
      case 'start':
        this.startMessage = message
        this.messageCallback?.({
          __vitest_worker_response__: true,
          type: 'started'
        })

        return

      case 'run':
      case 'collect':
      case 'stop':
        // Work messages are serialized: a file's databases must finish
        // resetting before the next file's message is processed, and a stop
        // must never overtake the file it is meant to stop.
        /* eslint-disable promise/prefer-await-to-then, promise/prefer-await-to-callbacks, typescript/promise-function-async */
        this.work = this.work
          .then(() => this.handleWork(message))
          .catch((error: unknown) => {
            this.errorCallback?.(error)
          })
        /* eslint-enable promise/prefer-await-to-then, promise/prefer-await-to-callbacks, typescript/promise-function-async */

        return

      case 'cancel':
        this.inner?.send(message)

        return

      default:
        this.inner?.send(message)
    }
  }

  /**
   * Vitest only consults this when the consumer configures `test.isolate:
   * false`. Returning true lets one workerd instance (and one module
   * registry) serve multiple test files sequentially; per-file database
   * isolation is preserved by resetting every database before the next
   * file's work message is forwarded.
   */
  canReuse(task: PoolTask): boolean {
    return !task.isolate && this.localdriveOptions.workerReuse
  }

  private async handleWork(message: WorkerRequest): Promise<void> {
    if (message.type === 'stop') {
      this.handleStop(message)

      return
    }

    if (message.type !== 'run' && message.type !== 'collect') {
      return
    }

    this.warnAboutPackedFiles(message)

    try {
      await (this.initialized ? this.resetForNewFile() : this.ensureInitialized())

      this.inner?.send(message)
    } catch (error) {
      // Report first so Vitest never hangs waiting for a file result, then
      // tear everything down so a subsequent file on this reused runner
      // (Vitest reuses it even after an errored file) starts from scratch.
      this.errorCallback?.(error)

      // If the inner worker failed to start the test file, we still need to
      // tell Vitest that the file finished so it can stop the runner.
      this.messageCallback?.({
        __vitest_worker_response__: true,
        type: 'testfileFinished',
        error
      })

      await this.teardown()
    }
  }

  /**
   * Vitest delivers several files inside a single request when the consumer
   * runs with `test.isolate: false` and a single worker; databases cannot be
   * reset between files that arrive together, so surface that clearly once
   * instead of silently running them against shared state.
   */
  private warnAboutPackedFiles(message: WorkRequest): void {
    if (this.packedFilesWarningShown) {
      return
    }

    if (message.context.files.length > 1) {
      this.packedFilesWarningShown = true
      console.warn(
        `[localdrive] Vitest delivered ${String(message.context.files.length)} test files to this worker in a single request `
        + '(this happens with test.isolate: false and maxWorkers: 1). The databases and the module registry '
        + 'are shared between these files; keep maxWorkers above 1 for per-file database isolation.'
      )
    }
  }

  private async ensureInitialized(): Promise<void> {
    const localdrive = getLocaldrive(this.options.project.name)

    if (localdrive === undefined) {
      throw new Error('[localdrive] Localdrive controller was not provided to the project')
    }

    const databases = await createLocaldriveDatabaseSet(localdrive, this.localdriveOptions)

    for (const database of Object.values(databases.databases)) {
      activeDatabases.add(database)
    }

    const controlServer = await startControlServer()

    for (const database of Object.values(databases.databases)) {
      controlServer.register(database)
    }

    const cloudflareOptions = resolveCloudflareOptions(
      this.localdriveOptions.cloudflare,
      databases.connectionStrings,
      controlServer.url
    )

    const inner = cloudflarePool(cloudflareOptions).createPoolWorker(this.options)

    await inner.start()

    inner.on('message', innerMessage => this.handleInnerMessage(innerMessage))
    inner.on('error', error => this.handleInnerError(error))
    inner.on('exit', () => this.handleInnerExit())

    this.databases = databases
    this.controlServer = controlServer
    this.inner = inner
    this.initialized = true

    // The intercepted Vitest start message is replayed to every fresh inner
    // worker: after a failed file the inner worker is torn down and rebuilt,
    // and its workerd runtime needs the same start context as before.
    if (this.startMessage !== undefined) {
      inner.send(this.startMessage)
    }
  }

  /**
   * Restores every database this worker owns to a fresh template clone plus
   * `beforeEach` SQL, so the next file sees state identical to a brand new
   * worker. Must resolve before the work message is forwarded: a file's
   * first query may never reach the previous file's database state.
   */
  private async resetForNewFile(): Promise<void> {
    await this.databases?.resetAll()
  }

  private async teardown(): Promise<void> {
    const inner = this.inner
    this.inner = undefined
    this.initialized = false
    await this.closeDatabases()

    if (inner !== undefined) {
      try {
        await inner.stop()
      } catch {
        // The inner worker may have failed mid-start; stopping is best-effort.
      }
    }
  }

  private handleStop(message: WorkerRequest): void {
    if (this.inner === undefined) {
      this.messageCallback?.({
        __vitest_worker_response__: true,
        type: 'stopped'
      })

      return
    }

    this.inner.send(message)
  }

  private handleInnerMessage(message: unknown): void {
    if (isStartedMessage(message)) {
      // We already sent a fake "started" response when the Vitest start
      // message arrived. Ignore the inner worker's started message to
      // avoid confusing Vitest's PoolRunner.
      return
    }

    this.messageCallback?.(message)
  }

  private handleInnerError(error: unknown): void {
    this.errorCallback?.(error)
  }

  private handleInnerExit(): void {
    this.exitCallback?.()
  }

  async stop(): Promise<void> {
    try {
      await this.inner?.stop()
    } finally {
      this.inner = undefined
      await this.closeDatabases()
      this.initialized = false
    }
  }

  private async closeDatabases(): Promise<void> {
    const databases = this.databases
    this.databases = undefined

    if (databases !== undefined) {
      for (const database of Object.values(databases.databases)) {
        activeDatabases.delete(database)
      }

      await databases.close()
    }

    await this.controlServer?.stop()
    this.controlServer = undefined
  }

  // eslint-disable-next-line promise/prefer-await-to-callbacks
  on(event: string, callback: (...args: unknown[]) => void): void {
    switch (event) {
      case 'message':
        this.messageCallback = callback
        break
      case 'error':
        this.errorCallback = callback
        break
      case 'exit':
        this.exitCallback = callback
        break
    }
  }

  off(event: string, _callback: (...args: unknown[]) => void): void {
    switch (event) {
      case 'message':
        this.messageCallback = undefined
        break
      case 'error':
        this.errorCallback = undefined
        break
      case 'exit':
        this.exitCallback = undefined
        break
    }
  }

  deserialize(data: unknown): unknown {
    return this.inner?.deserialize(data) ?? data
  }
}

export function localdriveCloudflarePool(
  options: LocaldriveCloudflareTestOptions
): PoolRunnerInitializer {
  const resolved: ResolvedLocaldrivePoolOptions = {
    bindings: options.bindings,
    databaseHost: options.databaseHost ?? 'thread',
    databaseHostResourceLimits: options.databaseHostResourceLimits,
    databaseHostRpcTimeoutMs: options.databaseHostRpcTimeoutMs ?? 60_000,
    workerReuse: options.workerReuse ?? true,
    cloudflare: options.cloudflare
  }

  return {
    name: 'localdrive-cloudflare-pool',
    createPoolWorker: poolOptions => new LocaldriveCloudflarePoolWorker(poolOptions, resolved)
  }
}

function resolveCloudflareOptions(
  cloudflare: LocaldriveCloudflareTestOptions['cloudflare'],
  hyperdrives: Record<string, string>,
  controlUrl: string
): CloudflarePoolOptions {
  if (typeof cloudflare === 'function') {
    return async context => {
      const resolved = await cloudflare(context)

      return mergeLocaldriveOptions(resolved, hyperdrives, controlUrl)
    }
  }

  return mergeLocaldriveOptions(cloudflare, hyperdrives, controlUrl)
}

function mergeLocaldriveOptions(
  options: ResolvedCloudflarePoolOptions,
  hyperdrives: Record<string, string>,
  controlUrl: string
): ResolvedCloudflarePoolOptions {
  return {
    ...options,
    miniflare: {
      ...options.miniflare,
      hyperdrives: {
        ...options.miniflare?.hyperdrives,
        ...hyperdrives
      },
      bindings: {
        ...options.miniflare?.bindings,
        LOCALDRIVE_CONTROL_URL: controlUrl
      }
    }
  }
}
