import type { PGliteInterface } from '@electric-sql/pglite'
import type { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import type { LocaldriveDatabase } from './types'


export class TestDatabase implements LocaldriveDatabase {
  readonly connectionString: string

  constructor(
    private readonly database: PGliteInterface,
    private readonly server: PGLiteSocketServer
  ) {
    this.connectionString = `postgresql://postgres@${server.getServerConn()}/postgres`
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
