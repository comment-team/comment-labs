import { cloudflarePool } from '@cloudflare/vitest-plugin'
import type { PoolOptions, PoolRunnerInitializer, PoolWorker, WorkerRequest } from 'vitest/node'
import { startControlServer, type LocaldriveControlServer } from './control-server'
import { getLocaldrive } from './registry'
import type { LocaldriveCloudflareTestOptions, LocaldriveDatabase } from './types'


type CloudflarePoolOptions = Parameters<typeof cloudflarePool>[0]
type CloudflarePoolFunction = Extract<CloudflarePoolOptions, (...args: never[]) => unknown>
type ResolvedCloudflarePoolOptions = Awaited<ReturnType<CloudflarePoolFunction>>

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
  private databases?: Record<string, LocaldriveDatabase>
  private controlServer?: LocaldriveControlServer
  private startMessage?: WorkerRequest

  constructor(
    private readonly options: PoolOptions,
    private readonly localdriveOptions: LocaldriveCloudflareTestOptions
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
        // eslint-disable-next-line promise/prefer-await-to-then, promise/prefer-await-to-callbacks
        this.handleWork(message).catch((error: unknown) => {
          this.errorCallback?.(error)
        })

        return

      case 'cancel':
        this.inner?.send(message)

        return

      default:
        this.inner?.send(message)
    }
  }

  private async handleWork(message: WorkerRequest): Promise<void> {
    if (message.type === 'stop') {
      this.handleStop(message)

      return
    }

    if (message.type !== 'run' && message.type !== 'collect') {
      return
    }

    const localdrive = getLocaldrive(this.options.project.name)

    if (localdrive === undefined) {
      throw new Error('[localdrive] Localdrive controller was not provided to the project')
    }

    try {
      this.databases = await localdrive.createTestDatabases()

      for (const database of Object.values(this.databases)) {
        activeDatabases.add(database)
      }

      const hyperdrives = Object.fromEntries(
        Object.entries(this.databases).map(([ name, database ]) => [ name, database.connectionString ])
      )

      this.controlServer = await startControlServer()

      for (const database of Object.values(this.databases)) {
        this.controlServer.register(database)
      }

      const cloudflareOptions = resolveCloudflareOptions(
        this.localdriveOptions.cloudflare,
        hyperdrives,
        this.controlServer.url
      )

      this.inner = cloudflarePool(cloudflareOptions).createPoolWorker(this.options)

      await this.inner.start()

      this.inner.on('message', innerMessage => this.handleInnerMessage(innerMessage))
      this.inner.on('error', error => this.handleInnerError(error))
      this.inner.on('exit', () => this.handleInnerExit())

      if (this.startMessage !== undefined) {
        this.inner.send(this.startMessage)
      }

      this.inner.send(message)
    } catch (error) {
      await this.closeDatabases()
      this.errorCallback?.(error)

      // If the inner worker failed to start the test file, we still need to
      // tell Vitest that the file finished so it can stop the runner.
      this.messageCallback?.({
        __vitest_worker_response__: true,
        type: 'testfileFinished',
        error
      })
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
    }
  }

  private async closeDatabases(): Promise<void> {
    if (this.databases === undefined) {
      return
    }

    const databases = this.databases
    this.databases = undefined

    await Promise.all(
      Object.values(databases).map(async database => {
        activeDatabases.delete(database)
        await database.close()
      })
    )

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

  canReuse(): boolean {
    // Each test file must get its own database clone and Hyperdrive bindings.
    // Returning false makes Vitest start a fresh worker for every file.
    return false
  }

  deserialize(data: unknown): unknown {
    return this.inner?.deserialize(data) ?? data
  }
}

export function localdriveCloudflarePool(
  options: LocaldriveCloudflareTestOptions
): PoolRunnerInitializer {
  return {
    name: 'localdrive-cloudflare-pool',
    createPoolWorker: poolOptions => new LocaldriveCloudflarePoolWorker(poolOptions, options)
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
