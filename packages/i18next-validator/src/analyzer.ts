import type { AnalysisResult, TranslationKey, Usage } from './types'
import { matchDynamicPattern } from './utils'


export function analyze(
  keys: TranslationKey[],
  usages: Usage[]
): AnalysisResult {
  const keyMap = new Map<string, TranslationKey>()

  for (const key of keys) {
    if (!keyMap.has(key.full)) {
      keyMap.set(key.full, key)
    }
  }

  const usedKeys = new Set<string>()

  for (const usage of usages) {
    if (usage.type === 'static' && keyMap.has(usage.full)) {
      usedKeys.add(usage.full)
    }
  }

  const patternUsages = usages.filter(
    (usage): usage is Extract<Usage, { type: 'pattern' }> => usage.type === 'pattern'
  )

  for (const [ full, key ] of keyMap) {
    if (usedKeys.has(full)) {
      continue
    }

    for (const pattern of patternUsages) {
      if (pattern.namespace === key.namespace && matchDynamicPattern(key.key, pattern.prefix, pattern.suffix)) {
        usedKeys.add(full)
        break
      }
    }
  }

  const dead: TranslationKey[] = []

  for (const [ full, key ] of keyMap) {
    if (usedKeys.has(full)) {
      continue
    }

    dead.push(key)
  }

  const used = Array.from(usedKeys, full => keyMap.get(full))
    .filter((key): key is TranslationKey => key !== undefined)

  return { dead, ambiguous: [], used, usages }
}
