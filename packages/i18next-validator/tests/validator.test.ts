import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import {
  analyze,
  discoverInitFile,
  findSourceFiles,
  loadTranslations,
  parseInitConfig,
  resolveLocaleSources,
  scanFile,
  scanSourceFiles
} from '../src/index'


const fixturesRoot = resolve(import.meta.dirname, 'fixtures')

async function analyzeFixture(fixtureName: string) {
  const cwd = resolve(fixturesRoot, fixtureName)
  const initFile = await discoverInitFile(cwd)
  const config = parseInitConfig(initFile)
  const sources = await resolveLocaleSources(cwd, initFile, undefined, config.localeSources)
  const keys = await loadTranslations(sources)
  const sourceFiles = await findSourceFiles(resolve(cwd, 'src'))
  const usages = scanSourceFiles(sourceFiles, {
    localeSources: config.localeSources,
    defaultNS: config.defaultNS ?? 'translation',
    nsSeparator: config.nsSeparator ?? ':',
    keySeparator: config.keySeparator ?? '.',
    fallbackNS: config.fallbackNS ?? [],
    preloadNS: config.preloadNS ?? [],
    interpolation: config.interpolation ?? { prefix: '{{', suffix: '}}' }
  })

  return analyze(keys, usages)
}

describe('i18next-validator', () => {
  it('finds unused keys in a basic backend-loaded fixture', async () => {
    const result = await analyzeFixture('basic')
    const deadFull = result.dead.map(key => key.full).sort()

    expect(deadFull).toStrictEqual([
      'common:home.welcome',
      'common:unused.key'
    ])
  })

  it('finds unused keys when locales are imported as modules', async () => {
    const result = await analyzeFixture('imported-locales')
    const deadFull = result.dead.map(key => key.full).sort()

    expect(deadFull).toStrictEqual([ 'common:unused.key' ])
  })

  it('uses explicit locales and namespace when provided', async () => {
    const cwd = resolve(fixturesRoot, 'basic')
    const sources = await resolveLocaleSources(
      cwd,
      resolve(cwd, 'i18n.ts'),
      './locales',
      []
    )
    const keys = await loadTranslations(sources)
    expect(keys.length).toBeGreaterThan(0)
  })

  it('does not require an init file when locales and namespace are explicit', async () => {
    const cwd = resolve(fixturesRoot, 'basic')
    const sources = await resolveLocaleSources(
      cwd,
      resolve(cwd, 'i18n.ts'),
      './locales',
      []
    )
    const keys = await loadTranslations(sources)
    const sourceFiles = await findSourceFiles(resolve(cwd, 'src'))
    const usages = scanSourceFiles(sourceFiles, {
      localeSources: sources,
      defaultNS: 'common',
      nsSeparator: ':',
      keySeparator: '.',
      fallbackNS: [],
      preloadNS: [],
      interpolation: { prefix: '{{', suffix: '}}' }
    })
    const result = analyze(keys, usages)

    expect(result.dead.map(key => key.full).sort()).toStrictEqual([
      'common:home.welcome',
      'common:unused.key'
    ])
  })

  it('handles named i18next imports, constant variables, and dynamic loadPath expressions', async () => {
    const result = await analyzeFixture('named-import')
    const deadFull = result.dead.map(key => key.full).sort()

    expect(deadFull).toStrictEqual([
      'translation:home.welcome',
      'translation:unused.key'
    ])
  })

  it('traces literal arguments into imported functions', async () => {
    const result = await analyzeFixture('cross-file')
    const deadFull = result.dead.map(key => key.full).sort()

    expect(deadFull).toStrictEqual([
      'common:direct.unused',
      'common:form.unused',
      'common:jsx.unused'
    ])
  })

  it('applies hook key prefixes and preserves dynamic prefixes', async () => {
    const result = await analyzeFixture('key-prefix')
    const deadFull = result.dead.map(key => key.full).sort()

    expect(deadFull).toStrictEqual([
      'translation:never',
      'translation:section.unused'
    ])

    expect(result.usages.some(usage => usage.type === 'static' && usage.full === 'translation:common.ok')).toBeTruthy()
  })

  it('scans a single file', () => {
    const file = resolve(fixturesRoot, 'basic/src/app.tsx')
    const usages = scanFile(file, {
      localeSources: [],
      defaultNS: 'common',
      nsSeparator: ':',
      keySeparator: '.',
      fallbackNS: [],
      preloadNS: [],
      interpolation: { prefix: '{{', suffix: '}}' }
    })

    expect(usages.some(usage => usage.type === 'static' && usage.full === 'common:home.title')).toBeTruthy()
    expect(usages.some(usage => usage.type === 'pattern' && usage.prefix === 'errors.')).toBeTruthy()
  })
})
