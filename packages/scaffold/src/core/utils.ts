import type { PackageJson } from './types'


const lineSplitPattern = /\r?\n/
const indentPattern = /^(\s+)"[^"]+":/

export function detectIndent(raw: string): string {
  const lines = raw.split(lineSplitPattern)

  for (const line of lines) {
    const match = indentPattern.exec(line)
    if (match) {
      return match[1] ?? '  '
    }
  }

  return '  '
}

export function isPackageJson(value: unknown): value is PackageJson {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
