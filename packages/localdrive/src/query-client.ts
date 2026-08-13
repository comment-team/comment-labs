import postgres from 'postgres'
import { getTestDatabaseByConnectionString } from './database-registry'


const clients = new Map<string, postgres.Sql>()

function getConnectionString(binding: string | { connectionString?: string }): string {
  return typeof binding === 'string' ? binding : binding.connectionString ?? ''
}

function isCloudflareWorker(): boolean {
  return 'WebSocketPair' in globalThis
}

interface LocaldriveControlEnv {
  LOCALDRIVE_CONTROL_URL?: unknown
}

function getControlUrl(env?: LocaldriveControlEnv): string {
  const fromEnv = env?.LOCALDRIVE_CONTROL_URL

  if (typeof fromEnv !== 'string') {
    throw new TypeError('Localdrive control URL is not configured')
  }

  return fromEnv
}

async function endClient(connectionString: string): Promise<void> {
  const client = clients.get(connectionString)

  if (client !== undefined) {
    await client.end()
    clients.delete(connectionString)
  }
}

export interface LocaldriveClientOptions {
  env?: { LOCALDRIVE_CONTROL_URL?: unknown }
}

export interface LocaldriveClient {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    params?: unknown[]
  ) => Promise<T[]>
  reset: () => Promise<void>
  end: () => Promise<void>
}

export async function resetLocaldriveDatabase(
  binding: string | { connectionString?: string },
  options: LocaldriveClientOptions = {}
): Promise<void> {
  const connectionString = getConnectionString(binding)

  if (isCloudflareWorker()) {
    const response = await fetch(getControlUrl(options.env), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionString })
    })

    if (!response.ok) {

      const body = await response.text().catch(() => '')

      throw new Error(`Localdrive reset failed: ${response.status} ${body}`)
    }

    await endClient(connectionString)

    return
  }

  const database = getTestDatabaseByConnectionString(connectionString)

  if (database === undefined) {
    throw new Error('Localdrive database not found')
  }

  await database.reset()
  await endClient(connectionString)
}

export function createLocaldriveClient(
  binding: string | { connectionString?: string },
  options: LocaldriveClientOptions = {}
): LocaldriveClient {
  const connectionString = getConnectionString(binding)

  function getClient(): postgres.Sql {
    let client = clients.get(connectionString)

    if (client === undefined) {
      client = postgres(connectionString, { max: 1 })
      clients.set(connectionString, client)
    }

    return client
  }

  return {
    query: async <T extends Record<string, unknown> = Record<string, unknown>>(
      query: string,
      params: unknown[] = []
    ): Promise<T[]> => {
      // eslint-disable-next-line typescript/no-unsafe-type-assertion
      const result = await getClient().unsafe(query, params as never[])

      // eslint-disable-next-line typescript/no-unsafe-type-assertion
      return result as unknown as T[]
    },
    reset: async (): Promise<void> => {
      await resetLocaldriveDatabase(connectionString, options)
    },
    end: async (): Promise<void> => {
      await endClient(connectionString)
    }
  }
}
