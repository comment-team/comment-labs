#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { createLogger, printResult, toErrorMessage, toIssueLocation } from './reporting'
import {
  convertIndent,
  createValidators,
  formatContent,
  getSupportedExtension,
  parseDocument,
  resolveSchemaSource,
  validateFileAgainstResolvedSchema,
  validateFileAgainstSchema,
  writeSchemaHint
} from './schema-document'
import { createSchemaStore } from './schema-store'
import type { CliOptions, Logger, Recommendation, ReporterMode, RunResult, Suggestion, ValidateFunction, ValidationIssue } from './types'


const urlSchemeRegex = /^https?:\/\//u


async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const result = await run(options)
  printResult(result, options.reporter)
  process.exitCode = result.issues.length > 0 ? 1 : 0
}

function parseArgs(argv: string[]): CliOptions {
  const paths: string[] = []
  let addRecommended = false
  let reporter: ReporterMode = isGitHubActions() ? 'github' : 'cli'
  let updateRecommended = false
  let indent: { insertSpaces: boolean; tabSize: number } | undefined
  let checkIndent: { insertSpaces: boolean; tabSize: number } | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]

    if (argument === undefined) {
      continue
    }

    if (argument === '--help' || argument === '-h') {
      printHelp()
      process.exit(0)
    }

    switch (true) {
      case argument === '--github-actions':
        reporter = 'github'
        continue
      case argument === '--add-recommended':
        addRecommended = true
        continue
      case argument === '--update-recommended':
        updateRecommended = true
        continue
      case argument === '--indent': {
        const value = argv[index + 1]
        if (value === undefined) {
          throw new Error('Expected --indent to have a value')
        }
        indent = parseIndentValue(value)
        index += 1
        continue
      }
      case argument.startsWith('--indent='): {
        const value = argument.slice('--indent='.length)
        indent = parseIndentValue(value)
        continue
      }
      case argument === '--check-indent': {
        const value = argv[index + 1]
        if (value === undefined) {
          throw new Error('Expected --check-indent to have a value')
        }
        checkIndent = parseIndentValue(value)
        index += 1
        continue
      }
      case argument.startsWith('--check-indent='): {
        const value = argument.slice('--check-indent='.length)
        checkIndent = parseIndentValue(value)
        continue
      }
      case argument === '--reporter': {
        const value = argv[index + 1]
        if (value !== 'cli' && value !== 'github') {
          throw new Error('Expected --reporter to be one of: cli, github')
        }

        reporter = value
        index += 1
        continue
      }
      case argument.startsWith('--reporter='): {
        const value = argument.slice('--reporter='.length)
        if (value !== 'cli' && value !== 'github') {
          throw new Error('Expected --reporter to be one of: cli, github')
        }

        reporter = value
        continue
      }
      case argument.startsWith('-'):
        throw new Error(`Unknown option: ${argument}`)
    }

    paths.push(argument)
  }

  return {
    addRecommended,
    checkIndent,
    indent,
    paths: paths.length > 0 ? paths : [ process.cwd() ],
    reporter,
    updateRecommended
  }
}

function parseIndentValue(value: string): { insertSpaces: boolean; tabSize: number } {
  if (value === 'tabs') {
    return { insertSpaces: false, tabSize: 1 }
  }
  if (value === 'spaces') {
    return { insertSpaces: true, tabSize: 2 }
  }
  if (value.startsWith('spaces-')) {
    const num = Number(value.slice('spaces-'.length))
    if (Number.isSafeInteger(num) && num > 0) {
      return { insertSpaces: true, tabSize: num }
    }
  }
  throw new Error('Expected --indent to be one of: spaces, spaces-<number>, tabs')
}

function isGitHubActions(): boolean {
  return process.env.GITHUB_ACTIONS === 'true'
}

function printHelp(): void {
  const lines = [
    'Usage:',
    '  schema-validator [options] [file-or-folder ...]',
    '',
    'Options:',
    '  --add-recommended       Save recommended schema hints into files that lack one',
    '  --update-recommended    Replace existing schema hints with the current recommendation when it differs',
    '  --indent <value>        Reformat all scanned files with the specified indentation (spaces, spaces-<n>, tabs)',
    '  --check-indent <value>  Report indentation mismatches without changing files (spaces, spaces-<n>, tabs)',
    '  --reporter <cli|github>  Output style. Default: cli',
    '  --github-actions         Shortcut for --reporter github',
    '  -h, --help               Show this help text',
    '',
    'If no file or folder is provided, the current working directory is used.'
  ]

  for (const line of lines) {
    console.log(line)
  }
}

async function run(options: CliOptions): Promise<RunResult> {
  const logger = createLogger()
  logger.progress(`Resolving input paths: ${options.paths.map(value => path.resolve(value)).join(', ')}`)

  const inputFiles = await collectInputFiles(options.paths, logger)
  logger.progress(`Found ${inputFiles.length} supported file(s) to check.`)

  const warnings: string[] = []
  const issues: ValidationIssue[] = []
  const suggestions: Suggestion[] = []
  const recommendations: Recommendation[] = []
  const seenRecommendations = new Set<string>()
  const schemaStore = createSchemaStore(warnings, logger)
  const validatorCache = new Map<string, Promise<ValidateFunction>>()
  const validators = createValidators(schemaStore)

  logger.startValidation(inputFiles.length)

  for (const filePath of inputFiles) {
    try {
      const parsed = await parseDocument(filePath, schemaStore)
      const schemaHint = parsed.schemaHint

      if ('source' in schemaHint) {
        if (options.updateRecommended) {
          const recommendation = await schemaStore.findRecommendation(filePath)
          if (
            recommendation
            && normalizeSchemaSpecifier(schemaHint.sourceText) !== normalizeSchemaSpecifier(recommendation.url)
          ) {
            logger.progress(`Updating schema for ${path.relative(process.cwd(), filePath) || filePath}`)

            const updatedSourceText = await writeSchemaHint(filePath, recommendation.url)
            logger.progress(`Updated schema for ${path.relative(process.cwd(), filePath) || filePath}: ${updatedSourceText}`)
            await validateFileAgainstSchema(
              filePath,
              parsed.data,
              updatedSourceText,
              validatorCache,
              validators,
              schemaStore,
              issues,
              logger
            )
            continue
          }
        }

        const schemaUrl = resolveSchemaSource(filePath, schemaHint.source)
        await validateFileAgainstResolvedSchema(
          filePath,
          parsed.data,
          schemaUrl,
          schemaHint.sourceText,
          validatorCache,
          validators,
          schemaStore,
          issues,
          logger
        )
        continue
      }

      if (!schemaHint.recommendation) {
        continue
      }

      if (options.addRecommended) {
        logger.progress(`Adding recommended schema to ${path.relative(process.cwd(), filePath) || filePath}`)

        const updatedSourceText = await writeSchemaHint(filePath, schemaHint.recommendation.url)
        logger.progress(`Saved recommended schema for ${path.relative(process.cwd(), filePath) || filePath}: ${updatedSourceText}`)
        await validateFileAgainstSchema(
          filePath,
          parsed.data,
          updatedSourceText,
          validatorCache,
          validators,
          schemaStore,
          issues,
          logger
        )
        continue
      }

      const key = `${filePath}:${schemaHint.recommendation.url}`
      if (!seenRecommendations.has(key)) {
        seenRecommendations.add(key)
        recommendations.push({
          filePath,
          schema: schemaHint.recommendation
        })
      }
    } catch (error) {
      issues.push({
        filePath,
        message: toErrorMessage(error),
        ...toIssueLocation(error)
      })
    } finally {
      logger.incrementValidation(filePath)
    }
  }

  if (options.checkIndent) {
    logger.progress(`Checking indentation for ${inputFiles.length} file(s)...`)
    for (const filePath of inputFiles) {
      try {
        const original = await readFile(filePath, 'utf8')
        const formatted = await formatContent(filePath, options.checkIndent)

        if (formatted !== null && original !== formatted) {
          suggestions.push({
            filePath,
            line: 1,
            diff: createDiff(original, formatted, filePath)
          })
          issues.push({
            filePath,
            line: 1,
            message: 'Indentation does not match the configured style',
            title: 'Indentation mismatch'
          })
        }
      } catch (error) {
        issues.push({
          filePath,
          message: toErrorMessage(error),
          ...toIssueLocation(error)
        })
      }
    }
  }

  if (options.indent) {
    logger.progress(`Converting indentation for ${inputFiles.length} file(s)...`)
    for (const filePath of inputFiles) {
      try {
        await convertIndent(filePath, options.indent)
        logger.progress(`Updated indentation for ${path.relative(process.cwd(), filePath) || filePath}`)
      } catch (error) {
        issues.push({
          filePath,
          message: toErrorMessage(error),
          ...toIssueLocation(error)
        })
      }
    }
  }

  logger.stopValidation()

  return {
    issues,
    recommendations,
    suggestions,
    warnings,
    checkedFiles: inputFiles.length
  }
}

async function collectInputFiles(inputPaths: string[], logger: Logger): Promise<string[]> {
  const foundFiles = new Set<string>()

  for (const inputPath of inputPaths) {
    const resolvedPath = path.resolve(inputPath)
    await walkPath(resolvedPath, foundFiles)
  }

  const sortedFiles = [ ...foundFiles ].toSorted()
  const visibleFiles = filterGitIgnoredFiles(sortedFiles, logger)

  return visibleFiles
}

async function walkPath(targetPath: string, foundFiles: Set<string>): Promise<void> {
  const targetStat = await stat(targetPath)

  if (targetStat.isDirectory()) {
    const entries = await readdir(targetPath, { withFileTypes: true })

    for (const entry of entries) {
      const childPath = path.join(targetPath, entry.name)
      if (entry.isDirectory()) {
        await walkPath(childPath, foundFiles)
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      if (isSupportedFile(childPath)) {
        foundFiles.add(childPath)
      }
    }

    return
  }

  if (targetStat.isFile() && isSupportedFile(targetPath)) {
    foundFiles.add(targetPath)
  }
}

function filterGitIgnoredFiles(filePaths: string[], logger: Logger): string[] {
  if (filePaths.length === 0) {
    return filePaths
  }

  try {
    const stdout = runGitCheckIgnore(filePaths)

    const ignoredFiles = new Set(
      stdout
        .split('\n')
        .map(value => value.trim())
        .filter(Boolean)
    )

    if (ignoredFiles.size > 0) {
      logger.progress(`Skipping ${ignoredFiles.size} .gitignore-matched file(s).`)
    }

    return filePaths.filter(filePath => !ignoredFiles.has(filePath))
  } catch (error) {
    const message = toErrorMessage(error)
    if (message.includes('not a git repository') || message.includes('No such file or directory')) {
      return filePaths
    }

    logger.progress(`Unable to apply .gitignore filtering. Continuing without it: ${message}`)

    return filePaths
  }
}

function runGitCheckIgnore(filePaths: string[]): string {
  const result = spawnSync('git', [ 'check-ignore', '--stdin' ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    input: filePaths.join('\n')
  })

  if (result.status === 0 || result.status === 1) {
    return result.stdout
  }

  if (result.error) {
    throw result.error
  }

  throw new Error(result.stderr.trim() || `git check-ignore exited with code ${result.status ?? 'unknown'}`)
}

function isSupportedFile(filePath: string): boolean {
  return getSupportedExtension(filePath) !== null
}

function createDiff(original: string, formatted: string, filePath: string): string {
  if (original === formatted) {
    return ''
  }

  const tmp = mkdtempSync(path.join(os.tmpdir(), 'schema-validator-'))
  const originalPath = path.join(tmp, 'original')
  const formattedPath = path.join(tmp, 'formatted')

  try {
    writeFileSync(originalPath, original, 'utf8')
    writeFileSync(formattedPath, formatted, 'utf8')

    const result = spawnSync('git', [ 'diff', '--no-index', '--unified=3', '--', originalPath, formattedPath ], {
      encoding: 'utf8'
    })

    if (result.status === 0) {
      return ''
    }

    if (result.status === 1) {
      const relativePath = path.relative(process.cwd(), filePath)

      return result.stdout
        .replace(/^diff --git .+\n/u, '')
        .replace(/^--- .+\n\+\+\+ .+\n/mu, `--- a/${relativePath}\n+++ b/${relativePath}\n`)
        .trimEnd()
    }

    throw new Error(result.stderr.trim() || `git diff exited with code ${result.status ?? 'unknown'}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function normalizeSchemaSpecifier(schemaText: string): string {
  if (urlSchemeRegex.test(schemaText)) {
    return normalizeSchemaUrl(schemaText)
  }

  return schemaText
}

function normalizeSchemaUrl(url: string): string {
  const normalizedUrl = new URL(url)

  if (
    normalizedUrl.protocol === 'http:'
    && [ 'json-schema.org', 'www.json-schema.org', 'json.schemastore.org', 'schemastore.org', 'www.schemastore.org' ].includes(normalizedUrl.hostname)
  ) {
    normalizedUrl.protocol = 'https:'
  }

  if (normalizedUrl.hostname === 'json-schema.org' && normalizedUrl.pathname === '/draft-07/schema') {
    normalizedUrl.pathname = '/draft-07/schema#'
  }

  return normalizedUrl.href
}

try {
  await main()
} catch (error: unknown) {
  console.error(toErrorMessage(error))
  process.exit(1)
}
