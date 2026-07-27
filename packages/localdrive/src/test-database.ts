import type { PGliteInterface } from '@electric-sql/pglite'
import type { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import type { LocaldriveConnectionStringOptions, LocaldriveDatabase } from './types'


const defaultConnectionStringOptions: Required<LocaldriveConnectionStringOptions> = {
  username: 'postgres',
  password: ''
}

export class TestDatabase implements LocaldriveDatabase {
  readonly connectionString: string

  constructor(
    private readonly database: PGliteInterface,
    private readonly server: PGLiteSocketServer,
    options: LocaldriveConnectionStringOptions = {}
  ) {
    const { username, password } = { ...defaultConnectionStringOptions, ...options }
    const credentials = password ? `${username}:${password}` : username

    this.connectionString = `postgresql://${credentials}@${server.getServerConn()}/postgres`
  }

  async testQuery<T extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    params: unknown[] = []
  ): Promise<T[]> {
    const result = await this.database.query<T>(query, params)

    return result.rows
  }

  async close(): Promise<void> {
    await this.server.stop()
    await this.database.close()
  }
}
