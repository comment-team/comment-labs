import { createServer } from 'node:http'
import { once } from 'node:events'


export interface Resettable {
  reset: () => Promise<void>
}

export interface LocaldriveControlServer {
  readonly url: string
  register: (database: Resettable) => void
  unregister: (database: Resettable) => void
  stop: () => Promise<void>
}

export async function startControlServer(): Promise<LocaldriveControlServer> {
  const databases = new Set<Resettable>()

  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/reset') {
      response.writeHead(404)
      response.end()

      return
    }

    // Discard the body; a reset restores every database registered with this
    // control server so callers do not need to identify the binding in a way
    // the server could match.
    request.resume()

    try {
      await Promise.all(Array.from(databases, async database => await database.reset()))

      response.writeHead(204)
      response.end()
    } catch {
      response.writeHead(500)
      response.end()
    }
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')

  const address = server.address()

  if (address === null || typeof address !== 'object') {
    throw new Error('Control server did not bind to a TCP port')
  }

  return {
    url: `http://127.0.0.1:${address.port}/reset`,
    register: (database): void => {
      databases.add(database)
    },
    unregister: (database): void => {
      databases.delete(database)
    },
    stop: async (): Promise<void> => {
      server.close()
      await once(server, 'close')
    }
  }
}
