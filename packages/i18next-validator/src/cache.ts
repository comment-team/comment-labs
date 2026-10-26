import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { isRecord } from './type-guards'


export interface CachedOptions {
  'init-file'?: string
  locales?: string
  'default-ns'?: string
}

const CACHE_PATH = join(homedir(), '.config', 'i18next-validator', 'cache.json')

export async function getCachedOptions(cwd: string): Promise<CachedOptions> {
  const cache = await readCache()
  const entry = cache[cwd]

  return isCachedOptions(entry) ? entry : {}
}

export async function setCachedOptions(cwd: string, options: CachedOptions): Promise<void> {
  const cache = await readCache()

  cache[cwd] = options
  await writeCache(cache)
}

async function readCache(): Promise<Record<string, CachedOptions>> {
  try {
    const content = await readFile(CACHE_PATH, 'utf8')

    return parseCache(JSON.parse(content))
  } catch {
    // ignore missing or corrupt cache
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

async function writeCache(cache: Record<string, CachedOptions>): Promise<void> {
  try {
    await mkdir(dirname(CACHE_PATH), { recursive: true })
    await writeFile(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`)
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
