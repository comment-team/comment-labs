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
    const controlUrl = 'http://127.0.0.1:11111/reset'

    /* eslint-disable typescript/no-unsafe-type-assertion */
    const inject = <K extends keyof ProvidedContext>(key: K): ProvidedContext[K] => {
      if (key === 'localdrive:controlUrl') {
        return controlUrl as unknown as ProvidedContext[K]
      }

      return connections as unknown as ProvidedContext[K]
    }
    /* eslint-enable typescript/no-unsafe-type-assertion */

    const options = localdrivePoolOptions(inject)

    expect(options).toStrictEqual({
      miniflare: {
        hyperdrives: {
          DB: 'postgresql://postgres@127.0.0.1:12345/postgres'
        },
        bindings: {
          LOCALDRIVE_CONTROL_URL: controlUrl
        }
      }
    })
  })
})
