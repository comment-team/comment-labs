import { PGlite, type PGliteInterface } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { randomUUID } from 'node:crypto'
import { readSql } from './sql'
import type { LocaldriveBindingOptions, LocaldriveConnectionStringOptions, LocaldriveDatabase } from './types'
import { registerTestDatabase, unregisterTestDatabase } from './database-registry'


const defaultConnectionStringOptions: Required<LocaldriveConnectionStringOptions> = {
  username: 'postgres',
  password: ''
}

export class TestDatabase implements LocaldriveDatabase {
  readonly connectionString: string

  private readonly template: PGlite
  private readonly beforeEach: LocaldriveBindingOptions['beforeEach']
  private readonly cwd: string
  private readonly host: string
  private readonly port: number
  private database: PGlite
  private server: PGLiteSocketServer
  private closed = false
  private resetting = false

  constructor(
    database: PGlite,
    server: PGLiteSocketServer,
    template: PGlite,
    beforeEach: LocaldriveBindingOptions['beforeEach'],
    cwd: string,
    options: LocaldriveConnectionStringOptions = {}
  ) {
    const { username, password } = { ...defaultConnectionStringOptions, ...options }
    const credentials = password ? `${username}:${password}` : username

    const connectionUrl = new URL(`postgresql://${credentials}@${server.getServerConn()}/postgres`)
    connectionUrl.searchParams.set('application_name', `localdrive-${randomUUID()}`)

    this.connectionString = connectionUrl.toString()

    this.template = template
    this.beforeEach = beforeEach
    this.cwd = cwd
    this.host = connectionUrl.hostname
    this.port = Number(connectionUrl.port)
    this.database = database
    this.server = server

    registerTestDatabase(this)
  }

  async testQuery<T extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    params: unknown[] = []
  ): Promise<T[]> {
    if (this.closed) {
      throw new Error('Database is already closed')
    }

    const result = await this.database.query<T>(query, params)

    return result.rows
  }

  async reset(): Promise<void> {
    if (this.closed) {
      throw new Error('Database is already closed')
    }

    if (this.resetting) {
      throw new Error('Reset already in progress')
    }

    this.resetting = true

    try {
      const database = await this.template.clone()

      if (!(database instanceof PGlite)) {
        throw new Error('Cloned database is not a PGlite instance')
      }

      await this.executeBeforeEach(database)

      const server = new PGLiteSocketServer({
        db: database,
        host: this.host,
        port: this.port,
        maxConnections: 16
      })

      await this.server.stop()
      await this.database.close()
      await server.start()

      this.database = database
      this.server = server
    } finally {
      this.resetting = false
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return
    }

    this.closed = true
    unregisterTestDatabase(this)
    await this.server.stop()
    await this.database.close()
  }

  private async executeBeforeEach(database: PGliteInterface): Promise<void> {
    const sqls = await readSql(this.beforeEach, this.cwd)

    for (const sql of sqls) {
      await database.exec(sql)
    }
  }
}
