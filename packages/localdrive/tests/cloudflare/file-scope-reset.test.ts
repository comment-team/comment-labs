/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="@cloudflare/workers-types" />
import { createLocaldriveClient } from '../../src/cloudflare-test-client'
import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it } from 'vitest'


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
const db = createLocaldriveClient(getConnectionString(binding), { env })

describe('file scope reset', () => {
  afterEach(async () => {
    await db.reset()
  })

  it('restores the baseline after inserts', async () => {
    await db.query('INSERT INTO items (name) VALUES ($1)', [ 'test' ])

    const rows = await db.query<{ name: string }>('SELECT name FROM items ORDER BY id')

    expect(rows).toHaveLength(2)
    expect(rows[0]?.name).toBe('before-each-item')
    expect(rows[1]?.name).toBe('test')
  })

  it('sees the baseline again after a reset', async () => {
    const rows = await db.query<{ name: string }>('SELECT name FROM items ORDER BY id')

    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe('before-each-item')
  })
})
