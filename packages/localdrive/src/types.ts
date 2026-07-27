import type { cloudflareTest } from '@cloudflare/vitest-pool-workers'

export type SqlSource = string | readonly string[]

export type CloudflareTestOptions = Parameters<typeof cloudflareTest>[0]

export interface LocaldriveConnectionStringOptions {
  username?: string
  password?: string
}

export interface LocaldriveBindingOptions {
  connectionString?: LocaldriveConnectionStringOptions
  migrations?: SqlSource
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
   * Defaults to "project" for backwards-compatible behavior.
   * "file" creates a fresh database clone for every test file.
   */
  databaseScope?: 'project' | 'file'

  /**
   * Passed through to cloudflareTest().
   */
  cloudflare: CloudflareTestOptions
}

export interface LocaldriveDatabase {
  readonly connectionString: string
  testQuery<T extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    params?: unknown[]
  ): Promise<T[]>
  close(): Promise<void>
}

export interface LocaldriveController {
  initialize(): Promise<void>
  createTestDatabases(): Promise<Record<string, LocaldriveDatabase>>
  close(): Promise<void>
}

export type LocaldriveConnections = Record<string, string>

declare module 'vitest' {
  export interface ProvidedContext {
    localdrive: LocaldriveConnections
    'localdrive:controller': LocaldriveController
  }
}
