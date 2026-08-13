import { extname } from 'node:path'
import { diagnostics } from './diagnostics'
import type { LocaleSource, TranslationKey } from './types'
import { expandDirectorySource } from './resolver'
import { flattenKeys, isRecord, parseJson } from './utils'


export { fileSourceFromPath } from './resolver'

export async function loadTranslations(sources: LocaleSource[]): Promise<TranslationKey[]> {
  const keys: TranslationKey[] = []

  for (const source of sources) {
    if (source.type === 'directory') {
      const expanded = expandDirectorySource(source)

      for (const fileSource of expanded) {
        keys.push(...(await loadFromSource(fileSource)))
      }
    } else {
      keys.push(...(await loadFromSource(source)))
    }
  }

  return dedupeKeys(keys)
}

async function loadFromSource(source: LocaleSource): Promise<TranslationKey[]> {
  let data: Record<string, unknown>

  if (source.type === 'inline') {
    data = source.data
  } else if (source.type === 'file') {
    data = await loadFile(source.path)
  } else {
    return []
  }

  const flattened: string[] = []
  flattenKeys(data, '', '.', flattened)

  return flattened.map(key => ({
    namespace: source.namespace,
    key,
    full: `${source.namespace}:${key}`,
    source
  }))
}

async function loadFile(path: string): Promise<Record<string, unknown>> {
  const ext = extname(path).toLowerCase()

  if (ext === '.json') {
    const parsed = parseJson(path)
    if (!isRecord(parsed)) {
      throw diagnostics.I18V_1007({ sources: [ path ] })
    }

    return parsed
  }

  if ([ '.js', '.mjs', '.cjs' ].includes(ext)) {
    const mod: unknown = await import(path)
    if (!isRecord(mod)) {
      throw diagnostics.I18V_1007({ sources: [ path ] })
    }

    const data = mod.default ?? mod
    if (!isRecord(data)) {
      throw diagnostics.I18V_1007({ sources: [ path ] })
    }

    return data
  }

  throw diagnostics.I18V_1007({ sources: [ path ] })
}

function dedupeKeys(keys: TranslationKey[]): TranslationKey[] {
  const seen = new Set<string>()
  const result: TranslationKey[] = []

  for (const key of keys) {
    if (seen.has(key.full)) {
      continue
    }

    seen.add(key.full)
    result.push(key)
  }

  return result
}
