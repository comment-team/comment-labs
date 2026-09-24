import type { ResourceLimits as WorkerResourceLimits } from 'node:worker_threads'
import type { cloudflareTest } from '@cloudflare/vitest-plugin'

export type SqlSource = string | readonly string[]

export type CloudflareTestOptions = Parameters<typeof cloudflareTest>[0]

export interface LocaldriveBindingOptions {
  migrations?: SqlSource
  seed?: SqlSource
  snapshot?: SqlSource
  beforeEach?: SqlSource
}

export interface LocaldriveOptions {
  bindings: Record<string, LocaldriveBindingOptions>
  cwd?: string
}

export interface LocaldrivePluginOptions extends LocaldriveOptions {
  hyperdrive?: boolean | { envPrefix?: string }
}

export interface LocaldriveCloudflareTestOptions extends LocaldriveOptions {
  /**
   * Defaults to "file" for per-file isolation.
   * "project" creates one clone per binding shared by all test files.
   */
  databaseScope?: 'project' | 'file'

  /**
   * Allow Vitest to reuse one pool worker (workerd instance, module registry,
   * and databases) across multiple test files. This is inert unless the
   * consumer configures `test.isolate: false`, because Vitest only consults
   * the worker for sharing in that case. Per-file database isolation is
   * preserved: every file still starts from a fresh template clone.
   * @default true
   */
  workerReuse?: boolean

  /**
   * Where the pool worker's PGlite instances and socket servers run.
   * "thread" moves them to a dedicated `worker_threads` worker so SQL from
   * parallel test files does not block the Vitest core thread.
   * "inline" keeps them on the core thread, like previous versions.
   * @default 'thread'
   */
  databaseHost?: 'thread' | 'inline'

  /**
   * `resourceLimits` passed to the database host worker thread.
   * Only applies when `databaseHost` is "thread".
   */
  databaseHostResourceLimits?: WorkerResourceLimits

  /**
   * Timeout in milliseconds for a single request to the database host worker
   * thread (create, reset, query, close). Only applies when `databaseHost`
   * is "thread".
   * @default 60_000
   */
  databaseHostRpcTimeoutMs?: number

  /**
   * Passed through to cloudflareTest().
   */
  cloudflare: CloudflareTestOptions
}

export interface LocaldriveDatabase {
  readonly connectionString: string
  testQuery: <T extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    params?: unknown[]
  ) => Promise<T[]>
  reset: () => Promise<void>
  close: () => Promise<void>
}

export interface LocaldriveController {
  initialize: () => Promise<void>
  createTestDatabases: () => Promise<Record<string, LocaldriveDatabase>>
  close: () => Promise<void>
}

export type LocaldriveConnections = Record<string, string>

declare module 'vitest' {
  export interface ProvidedContext {
    localdrive: LocaldriveConnections
    'localdrive:controlUrl': string
    'localdrive:controller': LocaldriveController
  }
}
