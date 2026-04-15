import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import type { CacheRecord, Logger, SchemaCatalogEntry, SchemaStore } from './types'


const ONE_DAY_MS = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 10_000
const SCHEMASTORE_CATALOG_URL = 'https://www.schemastore.org/api/json/catalog.json'

export function createSchemaStore(warnings: string[], logger: Logger): SchemaStore {
  const preferredCacheRoot = getPreferredCacheRoot()
  const cacheWarnings = new Set<string>()
  const schemaPromiseCache = new Map<string, Promise<Record<string, unknown>>>()
  const loggedFetches = new Set<string>()
  let resolvedCacheRoot: string | undefined
  let catalogPromise: Promise<SchemaCatalogEntry[]> | undefined

  async function getCacheRoot(): Promise<string> {
    if (resolvedCacheRoot !== undefined) {
      return resolvedCacheRoot
    }

    try {
      await mkdir(preferredCacheRoot, { recursive: true })
      resolvedCacheRoot = preferredCacheRoot

      return resolvedCacheRoot
    } catch (error) {
      const fallbackRoot = path.join(os.tmpdir(), 'comment-labs', 'schema-validator')
      await mkdir(fallbackRoot, { recursive: true })
      resolvedCacheRoot = fallbackRoot

      const warning = `Preferred cache directory is not writable (${preferredCacheRoot}). Falling back to ${fallbackRoot}: ${toErrorMessage(error)}`
      if (!cacheWarnings.has(warning)) {
        cacheWarnings.add(warning)
        warnings.push(warning)
      }

      return resolvedCacheRoot
    }
  }

  async function loadJson(url: string): Promise<Record<string, unknown>> {
    if (url.startsWith('file://')) {
      const filePath = decodeURIComponent(new URL(url).pathname)
      logger.progress(`Reading local schema: ${filePath}`)

      const payload = await readFile(filePath, 'utf8')

      return parseRecord(payload)
    }

    const normalizedUrl = normalizeSchemaUrl(url)
    let schemaPromise = schemaPromiseCache.get(normalizedUrl)

    if (!schemaPromise) {
      schemaPromise = (async () => {
        const cacheRoot = await getCacheRoot()
        const cached = await readCachedJson(cacheRoot, normalizedUrl, isRecord)

        return cached.value
      })()

      schemaPromiseCache.set(normalizedUrl, schemaPromise)
    }

    return schemaPromise
  }

  async function findRecommendation(filePath: string): Promise<SchemaCatalogEntry | undefined> {
    catalogPromise ??= (async () => {
      try {
        const cacheRoot = await getCacheRoot()
        logger.progress(`Loading SchemaStore catalog: ${SCHEMASTORE_CATALOG_URL}`)

        const catalog = await readCachedJson(cacheRoot, SCHEMASTORE_CATALOG_URL, isSchemaCatalogResponse)

        return catalog.value.schemas ?? []
      } catch (error) {
        const warning = `Unable to load the SchemaStore catalog. Recommendations are unavailable: ${toErrorMessage(error)}`
        if (!cacheWarnings.has(warning)) {
          cacheWarnings.add(warning)
          warnings.push(warning)
        }

        return []
      }
    })()

    const entries = await catalogPromise
    const relativePath = path.relative(process.cwd(), filePath).replaceAll('\\', '/')
    const baseName = path.basename(filePath)

    return entries.find(entry =>
      (entry.fileMatch ?? []).some(pattern => matchesFilePattern(pattern, relativePath, baseName)))
  }

  async function readCachedJson<T>(
    root: string,
    url: string,
    isValue: (value: unknown) => value is T
  ): Promise<{ status: 'fresh' | 'stale'; value: T }> {
    const cacheFile = path.join(root, `${createHash('sha256').update(url).digest('hex')}.json`)
    const now = Date.now()
    const cacheRecord = await readCacheFile(cacheFile, isValue)

    if (cacheRecord && now - cacheRecord.fetchedAt <= ONE_DAY_MS) {
      if (!loggedFetches.has(`${url}:cache-fresh`)) {
        loggedFetches.add(`${url}:cache-fresh`)
        logger.progress(`Using cached schema: ${url}`)
      }

      return {
        status: 'fresh',
        value: cacheRecord.value
      }
    }

    try {
      if (!loggedFetches.has(`${url}:fetch`)) {
        loggedFetches.add(`${url}:fetch`)
        logger.progress(`Fetching schema: ${url}`)
      }

      const response = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          accept: 'application/json',
          'user-agent': '@comment-labs/schema-validator'
        }
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const value: unknown = await response.json()
      if (!isValue(value)) {
        throw new Error(`Received unexpected JSON shape from ${url}`)
      }

      const record: CacheRecord<T> = {
        fetchedAt: now,
        value
      }
      await writeFile(cacheFile, JSON.stringify(record), 'utf8')

      return {
        status: 'fresh',
        value
      }
    } catch (error) {
      if (!cacheRecord) {
        throw new Error(`Failed to fetch ${url}: ${toErrorMessage(error)}`, { cause: error })
      }

      if (now - cacheRecord.fetchedAt > ONE_DAY_MS) {
        const warning = `Using stale cached schema data for ${url} because refresh failed: ${toErrorMessage(error)}`
        if (!cacheWarnings.has(warning)) {
          cacheWarnings.add(warning)
          warnings.push(warning)
        }
      }

      return {
        status: now - cacheRecord.fetchedAt > ONE_DAY_MS ? 'stale' : 'fresh',
        value: cacheRecord.value
      }
    }
  }

  return {
    findRecommendation,
    loadJson
  }
}

async function readCacheFile<T>(
  cacheFile: string,
  isValue: (value: unknown) => value is T
): Promise<CacheRecord<T> | undefined> {
  try {
    const payload = await readFile(cacheFile, 'utf8')

    return parseCacheRecord(payload, isValue)
  } catch {
    return undefined
  }
}

function getPreferredCacheRoot(): string {
  if (process.platform === 'win32') {
    const appData = process.env.LOCALAPPDATA ?? process.env.APPDATA
    if (typeof appData === 'string' && appData.length > 0) {
      return path.join(appData, 'comment-labs', 'schema-validator')
    }
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches', 'comment-labs', 'schema-validator')
  }

  const xdgCacheHome = process.env.XDG_CACHE_HOME
  if (xdgCacheHome !== undefined && xdgCacheHome.length > 0) {
    return path.join(xdgCacheHome, 'comment-labs', 'schema-validator')
  }

  return path.join(os.homedir(), '.cache', 'comment-labs', 'schema-validator')
}

function matchesFilePattern(pattern: string, relativePath: string, baseName: string): boolean {
  if (baseName === 'manifest.json') {
    return false
  }

  const normalizedPattern = pattern.replaceAll('\\', '/')

  if (!normalizedPattern.includes('/')) {
    return simpleGlobMatch(normalizedPattern, baseName)
  }

  return simpleGlobMatch(normalizedPattern, relativePath)
}

function simpleGlobMatch(pattern: string, candidate: string): boolean {
  const expandedPatterns = expandBracePatterns(pattern)
  const candidateSegments = candidate.split('/')

  return expandedPatterns.some(expandedPattern =>
    matchPatternSegments(expandedPattern.split('/'), candidateSegments))
}

function expandBracePatterns(pattern: string): string[] {
  const startIndex = pattern.indexOf('{')
  if (startIndex === -1) {
    return [ pattern ]
  }

  const endIndex = pattern.indexOf('}', startIndex + 1)
  if (endIndex === -1) {
    return [ pattern ]
  }

  const prefix = pattern.slice(0, startIndex)
  const suffix = pattern.slice(endIndex + 1)
  const variants = pattern.slice(startIndex + 1, endIndex).split(',')

  return variants.flatMap(variant => expandBracePatterns(`${prefix}${variant}${suffix}`))
}

function matchPatternSegments(patternSegments: string[], candidateSegments: string[]): boolean {
  const cache = new Map<string, boolean>()

  function match(patternIndex: number, candidateIndex: number): boolean {
    const cacheKey = `${patternIndex}:${candidateIndex}`
    const cached = cache.get(cacheKey)
    if (cached !== undefined) {
      return cached
    }

    let result = false
    const patternSegment = patternSegments[patternIndex]

    if (patternSegment === undefined) {
      result = candidateIndex === candidateSegments.length
    } else if (patternSegment === '**') {
      result = match(patternIndex + 1, candidateIndex)
        || (
          candidateIndex < candidateSegments.length
          && match(patternIndex, candidateIndex + 1)
        )
    } else {
      const candidateSegment = candidateSegments[candidateIndex]
      result = candidateSegment !== undefined
        && matchSegment(patternSegment, candidateSegment)
        && match(patternIndex + 1, candidateIndex + 1)
    }

    cache.set(cacheKey, result)

    return result
  }

  return match(0, 0)
}

function matchSegment(patternSegment: string, candidateSegment: string): boolean {
  const cache = new Map<string, boolean>()

  function match(patternIndex: number, candidateIndex: number): boolean {
    const cacheKey = `${patternIndex}:${candidateIndex}`
    const cached = cache.get(cacheKey)
    if (cached !== undefined) {
      return cached
    }

    let result = false
    const patternCharacter = patternSegment[patternIndex]

    switch (patternCharacter) {
      case undefined:
        result = candidateIndex === candidateSegment.length

        break

      case '*':
        result = match(patternIndex + 1, candidateIndex)
        || (
          candidateIndex < candidateSegment.length
          && match(patternIndex, candidateIndex + 1)
        )

        break

      case '?':
        result = candidateIndex < candidateSegment.length
        && match(patternIndex + 1, candidateIndex + 1)

        break

      default:
        result = candidateSegment[candidateIndex] === patternCharacter
        && match(patternIndex + 1, candidateIndex + 1)
    }

    cache.set(cacheKey, result)

    return result
  }

  return match(0, 0)
}

function normalizeSchemaUrl(url: string): string {
  const normalizedUrl = new URL(url)

  if (
    normalizedUrl.protocol === 'http:'
    && (
      normalizedUrl.hostname === 'json-schema.org'
      || normalizedUrl.hostname === 'www.json-schema.org'
      || normalizedUrl.hostname === 'json.schemastore.org'
      || normalizedUrl.hostname === 'schemastore.org'
      || normalizedUrl.hostname === 'www.schemastore.org'
    )
  ) {
    normalizedUrl.protocol = 'https:'
  }

  if (normalizedUrl.hostname === 'json-schema.org' && normalizedUrl.pathname === '/draft-07/schema') {
    normalizedUrl.pathname = '/draft-07/schema#'
  }

  return normalizedUrl.href
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseRecord(payload: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(payload)
  if (!isRecord(parsed)) {
    throw new Error('Expected a JSON object.')
  }

  return parsed
}

function isSchemaCatalogResponse(value: unknown): value is { schemas?: SchemaCatalogEntry[] } {
  if (!isRecord(value)) {
    return false
  }

  return value.schemas === undefined || Array.isArray(value.schemas)
}

function parseCacheRecord<T>(
  payload: string,
  isValue: (value: unknown) => value is T
): CacheRecord<T> | undefined {
  const parsed: unknown = JSON.parse(payload)
  if (!isRecord(parsed) || typeof parsed.fetchedAt !== 'number' || !('value' in parsed) || !isValue(parsed.value)) {
    return undefined
  }

  return {
    fetchedAt: parsed.fetchedAt,
    value: parsed.value
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
