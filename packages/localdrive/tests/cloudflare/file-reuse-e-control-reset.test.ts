/// <reference types="@cloudflare/vitest-plugin/types" />
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

describe('file reuse: control server resets through the host thread', () => {
  afterEach(async () => {
    await db.reset()
  })

  it('starts from the same baseline as every other file', async () => {
    const rows = await db.query<{ name: string }>('SELECT name FROM items ORDER BY id')

    expect(rows.map(row => row.name)).toStrictEqual([ 'before-each-item' ])
  })

  it('restores the baseline through the control server mid-file', async () => {
    await db.query('INSERT INTO items (name) VALUES ($1)', [ 'before-reset' ])
    await db.reset()

    const rows = await db.query<{ name: string }>('SELECT name FROM items ORDER BY id')

    expect(rows.map(row => row.name)).toStrictEqual([ 'before-each-item' ])

    await db.query('INSERT INTO items (name) VALUES ($1)', [ 'after-reset' ])

    const after = await db.query<{ name: string }>('SELECT name FROM items ORDER BY id')

    expect(after.map(row => row.name)).toStrictEqual([ 'before-each-item', 'after-reset' ])
  })

  it('sees the baseline again after the previous test reset', async () => {
    const rows = await db.query<{ name: string }>('SELECT name FROM items ORDER BY id')

    expect(rows.map(row => row.name)).toStrictEqual([ 'before-each-item' ])
  })
})
