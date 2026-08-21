/// <reference types="@cloudflare/vitest-plugin/types" />
/// <reference types="@cloudflare/workers-types" />
import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'


const connectionStringPattern = /^postgresql:\/\//u
const placeholderPattern = /:1\/postgres$/u

describe('project scope', () => {
  it('exposes a real Hyperdrive connection string, not the placeholder', async () => {
    // eslint-disable-next-line typescript/no-deprecated
    const response = await SELF.fetch(new Request('http://localhost/db'))
    const connectionString = await response.text()

    expect(connectionString).toMatch(connectionStringPattern)
    expect(connectionString).not.toMatch(placeholderPattern)
  })
})
