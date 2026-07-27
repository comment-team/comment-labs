import process from 'node:process'
import { cloudflarePool } from '@cloudflare/vitest-pool-workers'
import type { FileSpecification } from '@vitest/runner'
import type { PoolOptions, PoolRunnerInitializer, PoolWorker, WorkerRequest } from 'vitest/node'
import { getLocaldrive } from './registry'
import type { LocaldriveCloudflareTestOptions, LocaldriveDatabase } from './types'


type CloudflarePoolOptions = Parameters<typeof cloudflarePool>[0]
type CloudflarePoolFunction = Extract<CloudflarePoolOptions, (...args: never[]) => unknown>
type ResolvedCloudflarePoolOptions = Awaited<ReturnType<CloudflarePoolFunction>>

const activeDatabases = new Set<LocaldriveDatabase>()

process.once('SIGINT', () => {
  void Promise.all(Array.from(activeDatabases, async database => await database.close()))
    .finally(() => activeDatabases.clear())
})

process.once('SIGTERM', () => {
  void Promise.all(Array.from(activeDatabases, async database => await database.close()))
    .finally(() => activeDatabases.clear())
})

function isStartedMessage(message: unknown): boolean {
  return typeof message === 'object'
    && message !== null
    && '__vitest_worker_response__' in message
    && (message as Record<string, unknown>).type === 'started'
}

function getFilePath(files: FileSpecification[] | undefined): string | undefined {
  return files?.[0]?.filepath
}

class LocaldriveCloudflarePoolWorker implements PoolWorker {
  readonly name = 'localdrive-cloudflare-pool'
  readonly cacheFs = false

  private messageCallback?: (message: unknown) => void
  private errorCallback?: (error: unknown) => void
  private exitCallback?: () => void
  private inner?: PoolWorker
  private databases?: Record<string, LocaldriveDatabase>
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
        this.runWithLocaldrive(message).catch(error => this.errorCallback?.(error))

        return

      case 'stop':
        this.handleStop(message).catch(error => this.errorCallback?.(error))

        return

      case 'cancel':
        this.inner?.send(message)

        return

      default:
        this.inner?.send(message)
    }
  }

  private async runWithLocaldrive(message: WorkerRequest): Promise<void> {
    if (message.type !== 'run' && message.type !== 'collect') {
      return
    }

    const localdrive = getLocaldrive(this.options.project.name)

    if (localdrive === undefined) {
      throw new Error('[localdrive] Localdrive controller was not provided to the project')
    }

    getFilePath(message.context.files)

    try {
      this.databases = await localdrive.createTestDatabases()

      for (const database of Object.values(this.databases)) {
        activeDatabases.add(database)
      }

      const hyperdrives = Object.fromEntries(
        Object.entries(this.databases).map(([ name, database ]) => [ name, database.connectionString ])
      )

      const cloudflareOptions = resolveCloudflareOptions(this.localdriveOptions.cloudflare, hyperdrives)

      this.inner = cloudflarePool(cloudflareOptions).createPoolWorker(this.options)

      await this.inner.start()

      this.inner.on('message', innerMessage => {
        if (isStartedMessage(innerMessage)) {
          // We already sent a fake "started" response when the Vitest start
          // message arrived. Ignore the inner worker's started message to
          // avoid confusing Vitest's PoolRunner.
          return
        }

        this.messageCallback?.(innerMessage)
      })
      this.inner.on('error', error => this.errorCallback?.(error))
      this.inner.on('exit', () => this.exitCallback?.())

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

  private async handleStop(message: WorkerRequest): Promise<void> {
    if (this.inner === undefined) {
      this.messageCallback?.({
        __vitest_worker_response__: true,
        type: 'stopped'
      })

      return
    }

    this.inner.send(message)
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
  }

  on(event: string, callback: (...args: unknown[]) => void): void {
    if (event === 'message') {
      this.messageCallback = callback
    } else if (event === 'error') {
      this.errorCallback = callback
    } else if (event === 'exit') {
      this.exitCallback = callback
    }
  }

  off(event: string, _callback: (...args: unknown[]) => void): void {
    if (event === 'message') {
      this.messageCallback = undefined
    } else if (event === 'error') {
      this.errorCallback = undefined
    } else if (event === 'exit') {
      this.exitCallback = undefined
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
  hyperdrives: Record<string, string>
): CloudflarePoolOptions {
  if (typeof cloudflare === 'function') {
    return async context => {
      const resolved = await cloudflare(context)

      return mergeHyperdrives(resolved, hyperdrives)
    }
  }

  return mergeHyperdrives(cloudflare, hyperdrives)
}

function mergeHyperdrives(
  options: ResolvedCloudflarePoolOptions,
  hyperdrives: Record<string, string>
): ResolvedCloudflarePoolOptions {
  return {
    ...options,
    miniflare: {
      ...options.miniflare,
      hyperdrives: {
        ...options.miniflare?.hyperdrives,
        ...hyperdrives
      }
    }
  }
}
