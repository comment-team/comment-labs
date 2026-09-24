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

describe('file reuse: failed file recovery', () => {
  // `it.fails` still executes this test: it mutates the database, then
  // throws, leaving the runner in the exact state a crashed file leaves
  // behind. The next file on this runner asserts the pristine baseline.
  it.fails('mutates data and then fails mid-test', async () => {
    const rows = await db.query<{ name: string }>('SELECT name FROM items ORDER BY id')

    expect(rows.map(row => row.name)).toStrictEqual([ 'before-each-item' ])

    await db.query('INSERT INTO items (name) VALUES ($1)', [ 'marker-from-c-before-crash' ])

    throw new Error('intentional mid-test failure after mutating the database')
  })
})
