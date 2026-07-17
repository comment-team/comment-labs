import type { ProvidedContext } from 'vitest'
import { Localdrive } from './localdrive'
import type { LocaldriveOptions } from './types'


export { localdrivePlugin } from './plugin'

export function localdrive(options: LocaldriveOptions): Localdrive {
  return new Localdrive(options)
}

type Inject = <K extends keyof ProvidedContext>(key: K) => ProvidedContext[K]

export function localdrivePoolOptions(inject: Inject) {
  const connections = inject('localdrive')

  return {
    miniflare: {
      hyperdrives: Object.fromEntries(
        Object.entries(connections).map(([ name, connectionString ]) => [ name, connectionString ])
      )
    }
  }
}
