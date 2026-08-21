/// <reference types="@cloudflare/vitest-plugin/types" />
/// <reference types="@cloudflare/workers-types" />
import { createLocaldriveClient } from '../../src/cloudflare-test-client'
import { env } from 'cloudflare:test'
import { afterAll, describe, expect, it } from 'vitest'


function getConnectionString(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'object' && value !== null && 'connectionString' in value) {
    const record = value as Record<string, unknown>
    const connectionString = record.connectionString

    return typeof connectionString === 'string' ? connectionString : ''
  }

  return ''
}

// eslint-disable-next-line typescript/no-deprecated
const binding: unknown = Reflect.get(env, 'FLAGSHIP_DB')
const db = createLocaldriveClient(getConnectionString(binding))

describe('query client inside Cloudflare Worker test', () => {
  afterAll(async () => {
    await db.end()
  })

  it('runs queries against the Hyperdrive binding', async () => {
    const rows = await db.query<{ one: number }>('SELECT 1 AS one')

    expect(rows[0]).toStrictEqual({ one: 1 })
  })

  it('reuses the same connection for multiple queries', async () => {
    await db.query('CREATE TABLE counters (value integer)')
    await db.query('INSERT INTO counters (value) VALUES ($1)', [ 42 ])

    const rows = await db.query<{ value: number }>('SELECT value FROM counters')

    expect(rows[0]).toStrictEqual({ value: 42 })
  })
})
