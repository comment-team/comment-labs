#!/usr/bin/env node

import console from 'node:console'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { parse } from '@bomb.sh/args'
import tab from '@bomb.sh/tab'
import * as prompts from '@clack/prompts'
import { Diagnostic } from 'nostics'
import { analyze } from './analyzer'
import { parseInitConfig } from './config'
import { discoverInitFile } from './discovery'
import { loadTranslations } from './loader'
import { resolveLocaleSources } from './resolver'
import { formatResult } from './report'
import { findSourceFiles, scanSourceFiles } from './scanner'
import { getCachedOptions, setCachedOptions, type CachedOptions } from './cache'
import { diagnostics } from './diagnostics'
import { isString } from './type-guards'
import type { CliOptions, ExtractedConfig, LocaleSource, OutputFormat, ResolvedConfig } from './types'


const tabRoot = tab.command('i18next-validator', 'Find unused i18next translation keys')
tabRoot.option('init-file', 'Path to the i18next initialization file')
tabRoot.option('locales', 'Path to locale files or directory')
tabRoot.option('default-ns', 'Default i18next namespace')
tabRoot.option('source', 'Source directory to scan for key usage', complete => {
  complete('./src', 'Source directory')
})
tabRoot.option('format', 'Output format', complete => {
  complete('terminal', 'Human-readable output')
  complete('json', 'JSON output')
  complete('csv', 'CSV output')
})
tabRoot.option('fail-on-dead', 'Exit with non-zero code if dead keys are found')
tabRoot.option('verbose', 'Print additional diagnostic information')
tabRoot.option('debug', 'Log debug information for troubleshooting')
tabRoot.option('help', 'Show this help message')

function createDebugLogger(enabled: boolean): (...messages: unknown[]) => void {
  if (!enabled) {
    return () => { /* no debug logging */ }
  }

  return (...messages: unknown[]) => {
    console.error('[debug]', ...messages)
  }
}

function showHelp(): void {
  console.log(`
i18next-validator

Find unused i18next translation keys without configuration files.

Usage:
  i18next-validator [options]

Options:
  --init-file <path>     Path to the i18next initialization file
  --locales <path>       Path to locale files or directory
  --default-ns <ns>      Default i18next namespace
  --source <path>        Source directory to scan (auto-detected from ./src or the init file)
  --format <format>      Output format: terminal, json, csv (default: terminal)
  --fail-on-dead         Exit with non-zero code if dead keys are found
  --debug                Log debug information for troubleshooting
  -h, --help             Show this help message
  complete <shell>       Generate shell completion script
`)
}

function handleCompletion(args: string[]): void {
  const shell = args[0]
  if (shell === '--') {
    tab.parse(args.slice(1))

    return
  }

  if (shell === undefined) {
    console.error('Usage: i18next-validator complete <shell>')
    process.exit(1)
  }

  tab.setup('i18next-validator', 'i18next-validator', shell)
}

function isInteractive(): boolean {
  // oxlint-disable-next-line typescript/no-unnecessary-boolean-literal-compare
  return process.stdin.isTTY === true && process.stdout.isTTY === true
}

function parseArgs(argv: string[]): CliOptions {
  const args = parse(argv, {
    alias: { h: 'help' },
    boolean: [ 'fail-on-dead', 'verbose', 'debug', 'help' ],
    string: [ 'init-file', 'locales', 'default-ns', 'source', 'format' ],
    default: {
      format: 'terminal'
    }
  })

  const format = args.format
  const outputFormat: OutputFormat = format === 'json' || format === 'csv' ? format : 'terminal'

  return {
    'init-file': isString(args['init-file']) ? args['init-file'] : undefined,
    locales: isString(args.locales) ? args.locales : undefined,
    'default-ns': isString(args['default-ns']) ? args['default-ns'] : undefined,
    source: isString(args.source) ? args.source : undefined,
    format: outputFormat,
    'fail-on-dead': args['fail-on-dead'],
    verbose: args.verbose,
    debug: args.debug,
    help: args.help
  }
}

function buildResolvedConfig(
  config: ExtractedConfig | undefined,
  defaultNS: string
): ResolvedConfig {
  return {
    localeSources: config?.localeSources ?? [],
    defaultNS,
    nsSeparator: config?.nsSeparator ?? ':',
    keySeparator: config?.keySeparator ?? '.',
    fallbackNS: config?.fallbackNS ?? [],
    preloadNS: config?.preloadNS ?? [],
    interpolation: config?.interpolation ?? { prefix: '{{', suffix: '}}' }
  }
}

async function promptDefaultNS(placeholder = 'common'): Promise<string> {
  const effectivePlaceholder = placeholder
  const value = await prompts.text({
    message: 'What is the default i18next namespace?',
    placeholder: effectivePlaceholder,
    defaultValue: effectivePlaceholder,
    validate(input) {
      if (input !== undefined && typeof input !== 'string') {
        return 'Namespace is required'
      }

      // oxlint-disable-next-line unicorn/no-useless-undefined
      return undefined
    }
  })
  if (prompts.isCancel(value)) {
    prompts.cancel('Operation cancelled.')
    process.exit(0)
  }

  if (value === '') {
    return effectivePlaceholder
  }

  return value
}

async function promptLocales(placeholder = './public/locales'): Promise<string> {
  const effectivePlaceholder = placeholder
  const value = await prompts.text({
    message: 'Where are your locale files located?',
    placeholder: effectivePlaceholder,
    defaultValue: effectivePlaceholder,
    validate(input) {
      if (input !== undefined && typeof input !== 'string') {
        return 'Locale path is required'
      }

      // oxlint-disable-next-line unicorn/no-useless-undefined
      return undefined
    }
  })
  if (prompts.isCancel(value)) {
    prompts.cancel('Operation cancelled.')
    process.exit(0)
  }

  if (value === '') {
    return effectivePlaceholder
  }

  return value
}

async function discoverConfiguration(
  args: CliOptions,
  cwd: string,
  debug: (...messages: unknown[]) => void
): Promise<{ initFile?: string; config?: ExtractedConfig }> {
  let initFile: string | undefined
  let config: ExtractedConfig | undefined

  const hasExplicitConfig = args.locales !== undefined && args['default-ns'] !== undefined

  if (!hasExplicitConfig) {
    initFile = await discoverInitFile(cwd, args['init-file'])
    debug('init file:', initFile)
    config = parseInitConfig(initFile)
    debug('extracted defaultNS:', config.defaultNS)
    debug('extracted localeSources:', config.localeSources.map(source => `(${source.type}) ${source.path}`))
  } else if (args['init-file'] !== undefined) {
    initFile = await discoverInitFile(cwd, args['init-file'])
    debug('init file:', initFile)
    config = parseInitConfig(initFile)
    debug('extracted defaultNS:', config.defaultNS)
    debug('extracted localeSources:', config.localeSources.map(source => `(${source.type}) ${source.path}`))
  }

  return { initFile, config }
}

async function resolveDefaultNamespace(
  defaultNS: string | undefined,
  cwd: string,
  cached: CachedOptions,
  debug: (...messages: unknown[]) => void
): Promise<string> {
  if (defaultNS !== undefined) {
    return defaultNS
  }

  if (cached['default-ns'] !== undefined) {
    debug('defaultNS not resolved, using cached value:', cached['default-ns'])
    if (isInteractive()) {
      return await promptDefaultNS(cached['default-ns'])
    }

    return cached['default-ns']
  }

  debug('defaultNS not resolved, prompting interactively')
  if (isInteractive()) {
    return await promptDefaultNS()
  }

  throw diagnostics.I18V_1006({ sources: [ cwd ] })
}

async function resolveLocaleInput(
  explicitLocales: string | undefined,
  localeSources: LocaleSource[],
  cwd: string,
  cached: CachedOptions,
  debug: (...messages: unknown[]) => void
): Promise<string | undefined> {
  if (explicitLocales !== undefined || localeSources.length > 0) {
    return explicitLocales
  }

  if (cached.locales !== undefined) {
    debug('localeSources not resolved, using cached value:', cached.locales)
    if (isInteractive()) {
      return await promptLocales(cached.locales)
    }

    return cached.locales
  }

  debug('localeSources not resolved, prompting interactively')
  if (isInteractive()) {
    return await promptLocales()
  }

  throw diagnostics.I18V_1005({ sources: [ cwd ] })
}

async function run(argv: string[]): Promise<void> {
  if (argv[0] === 'complete') {
    handleCompletion(argv.slice(1))

    return
  }

  const args = parseArgs(argv)
  const debug = createDebugLogger(args.debug)

  if (args.help) {
    showHelp()

    return
  }

  const cwd = process.cwd()
  debug('cwd:', cwd)

  const cached = getCachedOptions(cwd)
  debug('cached options:', cached)

  const { initFile, config } = await discoverConfiguration(args, cwd, debug)
  const defaultNS = await resolveDefaultNamespace(
    args['default-ns'] ?? config?.defaultNS,
    cwd,
    cached,
    debug
  )
  const explicitLocales = await resolveLocaleInput(
    args.locales,
    config?.localeSources ?? [],
    cwd,
    cached,
    debug
  )

  const fallbackInitFile = initFile ?? join(cwd, 'i18n.ts')
  const sources = await resolveLocaleSources(
    cwd,
    fallbackInitFile,
    explicitLocales,
    config?.localeSources
  )
  debug('resolved locale sources:', sources.map(source => `(${source.type}) ${source.path}`))

  const keys = await loadTranslations(sources)
  debug('translation keys loaded:', keys.length)
  if (keys.length === 0) {
    throw diagnostics.I18V_1009({ sources: [ explicitLocales ?? fallbackInitFile ] })
  }

  const sourcePath = resolveSourcePath(cwd, fallbackInitFile, args.source)
  debug('source path:', sourcePath)
  if (!existsSync(sourcePath)) {
    throw diagnostics.I18V_1008({ sources: [ args.source ?? sourcePath ] })
  }

  const sourceFiles = await findSourceFiles(sourcePath)
  debug('source files to scan:', sourceFiles.length)

  const resolvedConfig = buildResolvedConfig(config, defaultNS)
  const usages = scanSourceFiles(sourceFiles, resolvedConfig)

  const result = analyze(keys, usages)
  debug(
    'usages:',
    usages.length,
    `(static: ${usages.filter(usage => usage.type === 'static').length},`,
    `pattern: ${usages.filter(usage => usage.type === 'pattern').length},`,
    `ambiguous: ${usages.filter(usage => usage.type === 'ambiguous').length})`
  )
  debug('keys — dead:', result.dead.length, 'ambiguous:', result.ambiguous.length, 'used:', result.used.length)

  setCachedOptions(cwd, {
    'init-file': args['init-file'] ?? initFile,
    'default-ns': defaultNS,
    locales: explicitLocales
  })

  const output = formatResult(result, args.format)
  console.log(output)

  if (args['fail-on-dead'] && result.dead.length > 0) {
    process.exit(1)
  }
}

function resolveSourcePath(cwd: string, initFile: string, source: string | undefined): string {
  if (source !== undefined) {
    return resolve(cwd, source)
  }

  const candidates = [
    resolve(cwd, 'src'),
    resolve(cwd, 'app'),
    resolve(cwd, 'pages'),
    resolve(initFile, '..')
  ]

  return candidates.find(candidate => existsSync(candidate)) ?? resolve(cwd, 'src')
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const formatIndex = args.indexOf('--format')
  const machineReadable
    = args.includes('--format=json')
    || args.includes('--format=csv')
    || (formatIndex !== -1 && (args[formatIndex + 1] === 'json' || args[formatIndex + 1] === 'csv'))
  const isTerminal = !machineReadable

  if (isTerminal) {
    prompts.intro('i18next-validator')
  }

  try {
    await run(args)
    if (isTerminal) {
      prompts.outro('Done')
    }
  } catch (error) {
    if (error instanceof Diagnostic) {
      process.exit(1)
    }

    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

await main()
