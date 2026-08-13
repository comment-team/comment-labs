import { existsSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { parseSync } from 'oxc-parser'
import { glob, globSync } from 'tinyglobby'
import { diagnostics } from './diagnostics'
import type { LocaleSource } from './types'
import { readText } from './utils'


const COMMON_LOCALE_DIRS = [
  'locales',
  'public/locales',
  'src/locales',
  'translations',
  'i18n',
  'src/i18n'
]

const LOCALE_FILE_EXTENSIONS = [
  'json',
  'yaml',
  'yml',
  'js',
  'ts',
  'jsx',
  'tsx',
  'mjs',
  'cjs'
]

const TRANSLATION_FILE_PATTERN = `**/*.{${LOCALE_FILE_EXTENSIONS.join(',')}}`

const EXTENSION_REGEX = /\.(?:json|yaml|yml|js|ts|jsx|tsx|mjs|cjs)$/iu
const PATH_SEPARATOR_REGEX = /[/\\]/u
const TWO_LETTERS_REGEX = /^[a-z]{2}$/iu
const TWO_LETTERS_UPPER_REGEX = /^[A-Z]{2}$/iu
const FILENAME_SEPARATOR_REGEX = /[-._]/u

export async function resolveLocaleSources(
  cwd: string,
  initFile: string,
  explicitLocales?: string,
  extractedSources: LocaleSource[] = []
): Promise<LocaleSource[]> {
  const sources: LocaleSource[] = [ ...extractedSources ]

  if (explicitLocales !== undefined) {
    const absolute = resolve(cwd, explicitLocales)
    if (!existsSync(absolute)) {
      throw diagnostics.I18V_1007({ sources: [ explicitLocales ] })
    }

    if (statSync(absolute).isDirectory()) {
      sources.push({ type: 'directory', path: absolute })
    } else {
      sources.push(fileSourceFromPath(absolute, initFile))
    }

    return dedupeSources(filterValidSources(sources))
  }

  const validSources = filterValidSources(sources)

  if (validSources.length > 0) {
    return dedupeSources(validSources)
  }

  const autoDir = await findCommonLocaleDirectory(cwd, initFile)
  if (autoDir !== undefined) {
    sources.push({ type: 'directory', path: autoDir })

    return dedupeSources(filterValidSources(sources))
  }

  const importedSources = findImportedLocaleFiles(initFile)
  if (importedSources.length > 0) {
    sources.push(...importedSources)

    return dedupeSources(filterValidSources(sources))
  }

  throw diagnostics.I18V_1005({ sources: [ cwd ] })
}

function isSourceValid(source: LocaleSource): boolean {
  switch (source.type) {
    case 'inline':
      return true

    case 'file':
      return existsSync(source.path) && EXTENSION_REGEX.test(source.path)

    case 'directory': {
      if (!existsSync(source.path) || !statSync(source.path).isDirectory()) {
        return false
      }

      const files = globSync(TRANSLATION_FILE_PATTERN, {
        cwd: source.path,
        absolute: true
      })

      return files.length > 0
    }

    default:
      return false
  }
}

function filterValidSources(sources: LocaleSource[]): LocaleSource[] {
  return sources.filter(source => isSourceValid(source))
}

async function findCommonLocaleDirectory(cwd: string, initFile: string): Promise<string | undefined> {
  const candidates = [
    ...COMMON_LOCALE_DIRS.map(dir => resolve(cwd, dir)),
    resolve(dirname(initFile), 'locales')
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      const files = await glob(TRANSLATION_FILE_PATTERN, {
        cwd: candidate,
        absolute: true
      })
      if (files.length > 0) {
        return candidate
      }
    }
  }

  return undefined
}

function findImportedLocaleFiles(initFile: string): LocaleSource[] {
  const sources: LocaleSource[] = []
  const baseDir = dirname(initFile)
  const source = readText(initFile)
  const result = parseSync(initFile, source)

  for (const item of result.module.staticImports) {
    const moduleRequest = item.moduleRequest.value
    if (!EXTENSION_REGEX.test(moduleRequest)) {
      continue
    }

    const absolute = resolve(baseDir, moduleRequest)
    if (!existsSync(absolute)) {
      continue
    }

    sources.push(fileSourceFromPath(absolute, initFile))
  }

  return sources
}

export function fileSourceFromPath(absolutePath: string, contextFile: string): LocaleSource {
  const relativePath = relative(dirname(contextFile), absolutePath)
  const parts = relativePath.split(PATH_SEPARATOR_REGEX)
  const filename = basename(absolutePath, extname(absolutePath))

  const filenameInferred = inferLanguageAndNamespace(filename)
  if (filenameInferred !== undefined) {
    return { type: 'file', path: absolutePath, ...filenameInferred }
  }

  if (parts.length >= 2) {
    const language = parts[0] ?? 'translation'
    const namespace = filename

    return { type: 'file', path: absolutePath, namespace, language }
  }

  if (parts.length === 1 && parts[0] !== undefined) {
    const language = looksLikeLanguageCode(filename) ? filename : 'translation'
    const namespace = looksLikeLanguageCode(filename) ? 'translation' : filename

    return { type: 'file', path: absolutePath, namespace, language }
  }

  return { type: 'file', path: absolutePath, namespace: filename, language: 'translation' }
}

function inferLanguageAndNamespace(filename: string): { language: string; namespace: string } | undefined {
  if (!FILENAME_SEPARATOR_REGEX.test(filename)) {
    return undefined
  }

  const segments = filename.split(FILENAME_SEPARATOR_REGEX)
  const first = segments[0]
  if (first !== undefined && looksLikeLanguageCode(first)) {
    const namespace = segments.slice(1).join('-')
    if (namespace.length > 0) {
      return { language: first, namespace }
    }
  }

  return undefined
}

function looksLikeLanguageCode(value: string): boolean {
  if (value.length !== 2 && value.length !== 5) {
    return false
  }

  if (!TWO_LETTERS_REGEX.test(value.slice(0, 2))) {
    return false
  }

  if (value.length === 2) {
    return true
  }

  return value[2] === '-' && TWO_LETTERS_UPPER_REGEX.test(value.slice(3))
}

export function expandDirectorySource(
  directory: LocaleSource & { type: 'directory' }
): LocaleSource[] {
  const files = globSync(TRANSLATION_FILE_PATTERN, {
    cwd: directory.path,
    absolute: true
  })

  return files.map(file => fileSourceFromPath(file, join(directory.path, 'i18n.ts')))
}

function dedupeSources(sources: LocaleSource[]): LocaleSource[] {
  const seen = new Set<string>()
  const result: LocaleSource[] = []

  for (const source of sources) {
    const key = sourceKey(source)
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    result.push(source)
  }

  return result
}

function sourceKey(source: LocaleSource): string {
  switch (source.type) {
    case 'file':
      return `${source.type}:${source.path}`
    case 'directory':
      return `${source.type}:${source.path}`
    case 'inline':
      return `${source.type}:${source.path}:${source.language}:${source.namespace}`
    default:
      return ''
  }
}
