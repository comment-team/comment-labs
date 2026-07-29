import { PGlite, type PGliteInterface } from '@electric-sql/pglite'
import { pg_stat_statements } from '@electric-sql/pglite/contrib/pg_stat_statements'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { unaccent } from '@electric-sql/pglite/contrib/unaccent'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import process from 'node:process'
import { resolve } from 'node:path'
import { readSql } from './sql'
import { TestDatabase } from './test-database'
import type { LocaldriveBindingOptions, LocaldriveController, LocaldriveDatabase, LocaldriveOptions } from './types'


const extensionSql = `
  CREATE EXTENSION IF NOT EXISTS plpgsql;
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE EXTENSION IF NOT EXISTS unaccent;
  CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
`

interface Template {
  options: LocaldriveBindingOptions
  database: PGlite
}

export class Localdrive implements LocaldriveController {
  private readonly cwd: string
  private readonly templates = new Map<string, Template>()
  private initialized = false

  constructor(private readonly options: LocaldriveOptions) {
    if (Object.keys(options.bindings).length === 0) {
      throw new Error('Localdrive requires at least one binding')
    }

    this.cwd = resolve(options.cwd ?? process.cwd())
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    try {
      for (const [ name, bindingOptions ] of Object.entries(this.options.bindings)) {
        const database = await PGlite.create({
          extensions: { pg_trgm, unaccent, pg_stat_statements }
        })
        await database.exec(extensionSql)
        await this.execute(database, bindingOptions.migrations)
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
        const database = await template.database.clone()
        await this.execute(database, template.options.beforeEach)

        if (!(database instanceof PGlite)) {
          throw new Error('Cloned database is not a PGlite instance')
        }

        const server = new PGLiteSocketServer({ db: database, host: '127.0.0.1', maxConnections: 16, port: 0 })
        await server.start()
        databases[name] = new TestDatabase(database, server, template.options.connectionString)
      }

      return databases
    } catch (error) {
      await Promise.all(Object.values(databases).map(async database => await database.close()))

      throw error
    }
  }

  async close(): Promise<void> {
    await Promise.all(Array.from(this.templates.values(), async ({ database }) => await database.close()))
    this.templates.clear()
    this.initialized = false
  }

  private async execute(database: PGliteInterface, source: LocaldriveBindingOptions['migrations']): Promise<void> {
    const sqls = await readSql(source, this.cwd)

    for (const sql of sqls) {
      await database.exec(sql)
    }
  }
}
