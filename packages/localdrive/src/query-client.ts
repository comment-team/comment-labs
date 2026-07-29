import postgres from 'postgres'


const clients = new Map<string, postgres.Sql>()

function isCloudflareWorker(): boolean {
  return 'WebSocketPair' in globalThis
}

export interface LocaldriveClient {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    params?: unknown[]
  ) => Promise<T[]>
  end: () => Promise<void>
}

export function createLocaldriveClient(
  binding: string | { connectionString?: string }
): LocaldriveClient {
  const connectionString = typeof binding === 'string' ? binding : binding.connectionString ?? ''
  let sql = clients.get(connectionString)

  if (sql === undefined) {
    sql = postgres(connectionString, { max: 1 })
    clients.set(connectionString, sql)
  }

  return {
    query: async <T extends Record<string, unknown> = Record<string, unknown>>(
      query: string,
      params: unknown[] = []
    ): Promise<T[]> => {
      // eslint-disable-next-line typescript/no-unsafe-type-assertion
      const result = await sql.unsafe(query, params as never[])

      // eslint-disable-next-line typescript/no-unsafe-type-assertion
      return result as unknown as T[]
    },
    end: async (): Promise<void> => {
      if (!isCloudflareWorker()) {
        await sql.end()
      }

      clients.delete(connectionString)
    }
  }
}
