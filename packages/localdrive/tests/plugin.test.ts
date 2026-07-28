import { describe, expect, expectTypeOf, it, type ProvidedContext } from 'vitest'
import { localdrivePlugin, localdrivePoolOptions } from '../src/vitest'


describe('localdrive plugin', () => {
  it('returns a vite plugin with the expected name', () => {
    const plugin = localdrivePlugin({ bindings: { DB: {} } })

    expect(plugin.name).toBe('localdrive')

    const configureVitest = plugin.configureVitest
    if (configureVitest === undefined) {
      throw new Error('configureVitest is missing')
    }

    expectTypeOf(configureVitest).toBeFunction()
  })

  it('builds pool options from injected connections', () => {
    const connections = { DB: 'postgresql://postgres@127.0.0.1:12345/postgres' }
    /* eslint-disable typescript/no-unsafe-type-assertion */
    const inject = <K extends keyof ProvidedContext>(_key: K): ProvidedContext[K] =>
      connections as unknown as ProvidedContext[K]
    /* eslint-enable typescript/no-unsafe-type-assertion */
    const options = localdrivePoolOptions(inject)

    expect(options).toStrictEqual({
      miniflare: {
        hyperdrives: {
          DB: 'postgresql://postgres@127.0.0.1:12345/postgres'
        }
      }
    })
  })
})
