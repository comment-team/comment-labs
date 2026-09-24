import { PGlite, type PGliteInterface } from '@electric-sql/pglite'
import { pg_stat_statements } from '@electric-sql/pglite/contrib/pg_stat_statements'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { unaccent } from '@electric-sql/pglite/contrib/unaccent'
import process from 'node:process'
import { resolve } from 'node:path'
import { startControlServer, type LocaldriveControlServer } from './control-server'
import { applySqlSource } from './sql'
import { LocaldriveSocketServer } from './socket-server'
import { TestDatabase } from './test-database'
import type { LocaldriveBindingOptions, LocaldriveController, LocaldriveDatabase, LocaldriveOptions } from './types'


const extensionSql = `
  CREATE EXTENSION IF NOT EXISTS plpgsql;
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE EXTENSION IF NOT EXISTS unaccent;
  CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
`

/**
 * PostgreSQL extensions that every Localdrive template installs. They must be
 * registered on any PGlite instance restored from a template dump so that
 * extension state kept inside the data directory keeps working.
 */
export const localdriveExtensions = {
  pg_trgm,
  unaccent,
  pg_stat_statements
}

interface Template {
  options: LocaldriveBindingOptions
  database: PGlite
}

/**
 * Clones a template, applies the binding's `beforeEach` SQL, and serves the
 * clone over a PostgreSQL wire socket. Shared by the core-thread controller
 * and the database host worker thread so both produce identical databases.
 */
export async function createTestDatabase(
  template: PGlite,
  options: LocaldriveBindingOptions,
  cwd: string
): Promise<TestDatabase> {
  const database = await template.clone()

  if (!(database instanceof PGlite)) {
    throw new Error('Cloned database is not a PGlite instance')
  }

  await applySqlSource(database, options.beforeEach, cwd)

  const server = new LocaldriveSocketServer({ db: database, host: '127.0.0.1', maxConnections: 16, port: 0 })
  await server.start()

  return new TestDatabase(database, server, template, options.beforeEach, cwd)
}

export class Localdrive implements LocaldriveController {
  readonly cwd: string
  private readonly templates = new Map<string, Template>()
  private readonly templateDumps = new Map<string, Uint8Array>()
  private activeDatabases: Record<string, LocaldriveDatabase> | undefined
  controlServer?: LocaldriveControlServer
  private initialized = false

  constructor(private readonly options: LocaldriveOptions) {
    if (Object.keys(options.bindings).length === 0) {
      throw new Error('Localdrive requires at least one binding')
    }

    this.cwd = resolve(options.cwd ?? process.cwd())
  }

  get controlUrl(): string | undefined {
    return this.controlServer?.url
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    try {
      this.controlServer = await startControlServer()

      for (const [ name, bindingOptions ] of Object.entries(this.options.bindings)) {
        const database = await PGlite.create({
          extensions: localdriveExtensions
        })
        await database.exec(extensionSql)
        await this.execute(database, bindingOptions.migrations)
        await this.execute(database, bindingOptions.seed)
        await this.execute(database, bindingOptions.snapshot)
        this.templates.set(name, { database, options: bindingOptions })
      }

      this.initialized = true
    } catch (error) {
      await this.close()

      throw error
    }
  }

  async createTestDatabases(): Promise<Record<string, LocaldriveDatabase>> {
    if (!this.initialized) {
      throw new Error('Call initialize() before creating test databases')
    }

    const databases: Record<string, LocaldriveDatabase> = {}

    try {
      for (const [ name, template ] of this.templates) {
        databases[name] = await createTestDatabase(template.database, template.options, this.cwd)
      }

      this.activeDatabases = databases

      return databases
    } catch (error) {
      await Promise.all(Object.values(databases).map(async database => await database.close()))

      throw error
    }
  }

  /**
   * Returns the template's data directory as a tar dump, so another thread or
   * process can restore an equivalent PGlite instance from it. The dump is
   * computed once per binding and cached for the controller's lifetime.
   */
  async getTemplateDataDir(name: string): Promise<Uint8Array> {
    if (!this.initialized) {
      throw new Error('Call initialize() before reading template dumps')
    }

    const cached = this.templateDumps.get(name)

    if (cached !== undefined) {
      return cached
    }

    const template = this.templates.get(name)

    if (template === undefined) {
      throw new Error(`Unknown Localdrive binding: ${name}`)
    }

    const dump = await template.database.dumpDataDir()
    const bytes = new Uint8Array(await dump.arrayBuffer())

    this.templateDumps.set(name, bytes)

    return bytes
  }

  async reset(): Promise<void> {
    if (this.activeDatabases === undefined) {
      return
    }

    await Promise.all(Object.values(this.activeDatabases).map(async database => await database.reset()))
  }

  async close(): Promise<void> {
    if (this.activeDatabases !== undefined) {
      await Promise.all(Object.values(this.activeDatabases).map(async database => await database.close()))
      this.activeDatabases = undefined
    }

    await Promise.all(Array.from(this.templates.values(), async ({ database }) => await database.close()))
    this.templates.clear()
    this.templateDumps.clear()

    if (this.controlServer !== undefined) {
      await this.controlServer.stop()
      this.controlServer = undefined
    }

    this.initialized = false
  }

  private async execute(database: PGliteInterface, source: LocaldriveBindingOptions['migrations']): Promise<void> {
    await applySqlSource(database, source, this.cwd)
  }
}
