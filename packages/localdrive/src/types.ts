export type SqlSource = string | readonly string[]

export interface LocaldriveBindingOptions {
  migrations?: SqlSource
  snapshot?: SqlSource
  beforeEach?: SqlSource
}

export interface LocaldriveOptions {
  bindings: Record<string, LocaldriveBindingOptions>
  cwd?: string
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
  }
}
