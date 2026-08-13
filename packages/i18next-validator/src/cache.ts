import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { isRecord } from './type-guards'


export interface CachedOptions {
  'init-file'?: string
  locales?: string
  'default-ns'?: string
}

const CACHE_PATH = join(homedir(), '.config', 'i18next-validator', 'cache.json')

export function getCachedOptions(cwd: string): CachedOptions {
  const cache = readCache()
  const entry = cache[cwd]

  return isCachedOptions(entry) ? entry : {}
}

export function setCachedOptions(cwd: string, options: CachedOptions): void {
  const cache = readCache()

  cache[cwd] = options
  writeCache(cache)
}

function readCache(): Record<string, CachedOptions> {
  if (!existsSync(CACHE_PATH)) {
    return {}
  }

  try {
    const content = readFileSync(CACHE_PATH, 'utf8')

    return parseCache(JSON.parse(content))
  } catch {
    // ignore corrupt cache
  }

  return {}
}

function parseCache(value: unknown): Record<string, CachedOptions> {
  const result: Record<string, CachedOptions> = {}

  if (!isRecord(value)) {
    return result
  }

  for (const [ key, entry ] of Object.entries(value)) {
    if (isCachedOptions(entry)) {
      result[key] = entry
    }
  }

  return result
}

function writeCache(cache: Record<string, CachedOptions>): void {
  try {
    mkdirSync(dirname(CACHE_PATH), { recursive: true })
    writeFileSync(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`)
  } catch {
    // ignore failed writes
  }
}

function isCachedOptions(value: unknown): value is CachedOptions {
  if (!isRecord(value)) {
    return false
  }

  return (
    (value['init-file'] === undefined || typeof value['init-file'] === 'string')
    && (value.locales === undefined || typeof value.locales === 'string')
    && (value['default-ns'] === undefined || typeof value['default-ns'] === 'string')
  )
}
