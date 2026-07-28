import postgres from 'postgres'


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
  const sql = postgres(connectionString)

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
      await sql.end()
    }
  }
}
