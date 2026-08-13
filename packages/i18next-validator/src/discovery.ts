import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseSync, Visitor } from 'oxc-parser'
import { glob } from 'tinyglobby'
import { diagnostics } from './diagnostics'
import {
  isCallExpression,
  isExportDefaultDeclaration,
  isIdentifier,
  isMemberExpression
} from './type-guards'
import { readText } from './utils'


export interface InitCandidate {
  path: string
  score: number
}

const INIT_IMPORT_SOURCES = new Set([
  'i18next',
  'react-i18next'
])

const CANDIDATE_GLOBS = [
  '**/*i18n*.{ts,tsx,js,jsx,mjs,cjs}',
  '**/i18n/**/*.{ts,tsx,js,jsx,mjs,cjs}'
]

const EXCLUDE_GLOBS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.*/**',
  '**/*.d.ts'
]

export async function discoverInitFile(
  cwd: string,
  explicitInitFile?: string
): Promise<string> {
  if (explicitInitFile !== undefined) {
    const absolute = resolve(cwd, explicitInitFile)
    if (!existsSync(absolute)) {
      throw diagnostics.I18V_1003({ sources: [ explicitInitFile ] })
    }

    return absolute
  }

  const candidates = await findCandidateFiles(cwd)
  const scored = candidates
    .map(path => scoreCandidate(path))
    .filter((candidate): candidate is InitCandidate => candidate.score > 0)
    .toSorted((left, right) => right.score - left.score)

  if (scored.length === 0) {
    throw diagnostics.I18V_1001({ sources: [ cwd ] })
  }

  const topScore = scored[0]?.score ?? 0
  const topFiles = scored.filter(candidate => candidate.score === topScore)

  if (topFiles.length > 1) {
    throw diagnostics.I18V_1002({
      sources: topFiles.map(file => file.path)
    })
  }

  const winner = topFiles[0]
  if (winner === undefined) {
    throw diagnostics.I18V_1001({ sources: [ cwd ] })
  }

  return winner.path
}

async function findCandidateFiles(cwd: string): Promise<string[]> {
  return await glob(CANDIDATE_GLOBS, {
    cwd,
    ignore: EXCLUDE_GLOBS,
    absolute: true
  })
}

function scoreCandidate(path: string): InitCandidate {
  let score = 0

  try {
    const source = readText(path)
    const result = parseSync(path, source)

    const importsFromI18next = result.module.staticImports.filter(item =>
      INIT_IMPORT_SOURCES.has(item.moduleRequest.value))

    if (importsFromI18next.length > 0) {
      score += 1
    }

    const localNames = new Set(
      importsFromI18next.flatMap(item => item.entries.map(entry => entry.localName.value))
    )
    const defaultI18next = importsFromI18next
      .flatMap(item =>
        item.entries
          // oxlint-disable-next-line typescript/no-unsafe-enum-comparison
          .filter(entry => entry.importName.kind === 'Default')
          .map(entry => entry.localName.value))

    let foundInit = false
    let foundDefaultExport = false

    const visitor = new Visitor({
      CallExpression(node) {
        if (isInitCall(node, localNames, defaultI18next)) {
          foundInit = true
        }
      },
      ExportDefaultDeclaration(node) {
        if (isDefaultExportOfInstance(node, localNames)) {
          foundDefaultExport = true
        }
      }
    })

    visitor.visit(result.program)

    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (foundInit) {
      score += 2
    }

    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (foundDefaultExport) {
      score += 1
    }
  } catch {
    // ignore unparsable files
  }

  return { path, score }
}

function isInitCall(
  node: unknown,
  localNames: Set<string>,
  defaultI18next: string[]
): boolean {
  if (!isCallExpression(node)) {
    return false
  }

  const callee = node.callee

  if (isMemberExpression(callee)) {
    return (
      isIdentifier(callee.object)
      && localNames.has(callee.object.name)
      && isIdentifier(callee.property)
      && callee.property.name === 'init'
    )
  }

  if (isIdentifier(callee) && callee.name === 'init') {
    return localNames.has(callee.name)
  }

  if (isIdentifier(callee) && callee.name === 'createInstance') {
    return defaultI18next.includes(callee.name)
  }

  return false
}

function isDefaultExportOfInstance(
  node: unknown,
  localNames: Set<string>
): boolean {
  if (!isExportDefaultDeclaration(node)) {
    return false
  }

  const declaration = node.declaration
  if (isIdentifier(declaration)) {
    return localNames.has(declaration.name)
  }

  return false
}
