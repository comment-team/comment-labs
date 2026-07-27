/* eslint-disable typescript/no-unsafe-type-assertion, typescript/no-unnecessary-type-assertion */
export default {
  fetch(request: Request, env: Record<string, unknown>): Response | Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/db') {
      return new Response(getConnectionString(env.FLAGSHIP_DB))
    }

    return new Response('ok')
  }
}

function getConnectionString(binding: unknown): string {
  if (typeof binding === 'string') {
    return binding
  }

  const record = binding as unknown as Record<string, unknown>

  if ('connectionString' in record && typeof record.connectionString === 'string') {
    return record.connectionString
  }

  throw new Error('Expected a Hyperdrive binding with a connection string')
}
