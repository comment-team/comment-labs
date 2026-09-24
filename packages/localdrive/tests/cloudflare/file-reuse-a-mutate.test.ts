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

// Every file in this suite asserts the same pristine baseline on its first
// query: migration schema + `beforeEach` row, and nothing else. Files run
// sequentially on one shared runner (isolate: false, maxWorkers: 1), so each
// assertion also proves the previous file's mutations were reset away.
async function itemNames(): Promise<string[]> {
  const rows = await db.query<{ name: string }>('SELECT name FROM items ORDER BY id')

  return rows.map(row => row.name)
}

async function expectPristineBaseline(): Promise<void> {
  await expect(itemNames()).resolves.toStrictEqual([ 'before-each-item' ])
}

describe('file reuse: mutation without cleanup', () => {
  it('starts from a pristine baseline', async () => {
    expect.hasAssertions()

    await expectPristineBaseline()
  })

  it('leaves markers behind on purpose', async () => {
    expect.hasAssertions()

    await db.query('INSERT INTO items (name) VALUES ($1)', [ 'marker-from-a' ])
    await db.query('CREATE TABLE IF NOT EXISTS leftovers (value text)')
    await db.query('INSERT INTO leftovers (value) VALUES ($1)', [ 'leftover-from-a' ])

    await expect(itemNames()).resolves.toStrictEqual([ 'before-each-item', 'marker-from-a' ])
  })
})
