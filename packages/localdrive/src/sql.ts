import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { glob } from 'tinyglobby'
import type { SqlSource } from './types'


const globPattern = /[!*?[\]{}]/

export async function readSql(source: SqlSource | undefined, cwd: string): Promise<string[]> {
  if (source === undefined) {
    return []
  }

  const paths: string[] = []
  const entries = typeof source === 'string' ? [ source ] : source

  for (const entry of entries) {
    if (isGlob(entry)) {
      const matches = await glob(entry, { absolute: true, cwd, onlyFiles: true })

      if (matches.length === 0) {
        throw new Error(`SQL glob matched no files: ${entry}`)
      }

      paths.push(...matches.sort())
      continue
    }

    paths.push(isAbsolute(entry) ? entry : resolve(cwd, entry))
  }

  const files = await Promise.all(paths.map(async path => await readFile(path, 'utf8')))

  return files
}

function isGlob(source: string): boolean {
  return globPattern.test(source)
}
