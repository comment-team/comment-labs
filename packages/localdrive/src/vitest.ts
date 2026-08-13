import type { ProvidedContext } from 'vitest'
import { Localdrive } from './localdrive'
import type { LocaldriveOptions } from './types'


export { localdriveCloudflareTest } from './cloudflare-test'
export { localdrivePlugin } from './plugin'

export function localdrive(options: LocaldriveOptions): Localdrive {
  return new Localdrive(options)
}

type Inject = <K extends keyof ProvidedContext>(key: K) => ProvidedContext[K]

export function localdrivePoolOptions(inject: Inject) {
  const connections = inject('localdrive')
  const controlUrl = inject('localdrive:controlUrl')

  return {
    miniflare: {
      hyperdrives: Object.fromEntries(
        Object.entries(connections).map(([ name, connectionString ]) => [ name, connectionString ])
      ),
      bindings: {
        LOCALDRIVE_CONTROL_URL: controlUrl
      }
    }
  }
}
