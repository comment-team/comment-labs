/// <reference types="@cloudflare/vitest-plugin/types" />
/// <reference types="@cloudflare/workers-types" />
import { createLocaldriveClient } from '../../src/cloudflare-test-client'
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'


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

describe('file reuse: cross-file isolation', () => {
  it('does not see the previous file rows or tables', async () => {
    const rows = await db.query<{ name: string }>('SELECT name FROM items ORDER BY id')

    expect(rows.map(row => row.name)).toStrictEqual([ 'before-each-item' ])

    // File A created this table without cleaning up; a fresh template clone
    // must not have it.
    const tables = await db.query<{ table_name: string }>(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name',
      [ 'public' ]
    )

    expect(tables.map(row => row.table_name)).not.toContain('leftovers')
  })

  it('leaves its own markers behind for the next file', async () => {
    await db.query('INSERT INTO items (name) VALUES ($1)', [ 'marker-from-b' ])

    const rows = await db.query<{ name: string }>('SELECT name FROM items ORDER BY id')

    expect(rows.map(row => row.name)).toStrictEqual([ 'before-each-item', 'marker-from-b' ])
  })
})
