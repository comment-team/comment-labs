/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="@cloudflare/workers-types" />
import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'


const connectionStringPattern = /^postgresql:\/\//u

describe('project scope', () => {
  it('exposes a Hyperdrive connection string', async () => {
    // eslint-disable-next-line typescript/no-deprecated
    const response = await SELF.fetch(new Request('http://localhost/db'))
    const connectionString = await response.text()

    expect(connectionString).toMatch(connectionStringPattern)
  })
})
