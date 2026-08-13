import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isRecord as isRecordGuard } from './type-guards'


export { isRecord, isString } from './type-guards'


export function readText(path: string): string {
  return readFileSync(resolve(path), 'utf8')
}

export function parseJson(path: string): unknown {
  return JSON.parse(readText(path)) as unknown
}

export function flattenKeys(
  value: unknown,
  prefix: string,
  separator: string,
  result: string[]
): void {
  if (isRecordGuard(value)) {
    for (const [ key, nested ] of Object.entries(value)) {
      const full = prefix === '' ? key : `${prefix}${separator}${key}`
      flattenKeys(nested, full, separator, result)
    }
  } else if (value !== undefined) {
    result.push(prefix)
  }
}

export function matchDynamicPattern(key: string, prefix: string, suffix: string): boolean {
  if (!key.startsWith(prefix)) {
    return false
  }

  const middle = key.slice(prefix.length)
  if (suffix === '') {
    return middle.length > 0
  }

  if (!middle.endsWith(suffix)) {
    return false
  }

  const inner = middle.slice(0, middle.length - suffix.length)

  return inner.length > 0
}

export function splitNamespaceKey(
  full: string,
  namespace: string,
  nsSeparator: string
): { namespace: string; key: string } {
  if (full.includes(nsSeparator)) {
    const parts = full.split(nsSeparator)
    const ns = parts[0]
    const rest = parts.slice(1).join(nsSeparator)
    if (ns !== undefined && ns.length > 0) {
      return { namespace: ns, key: rest }
    }
  }

  return { namespace, key: full }
}
