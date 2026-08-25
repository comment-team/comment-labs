import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { applyFileDecision, exists } from '../core/filesystem'
import type { WorkspacePackage } from '../core/package-step'
import { askEphemeralStep, askSelect, askStep } from '../core/prompts'
import { applyProtectedFileStep, decideFileStep, decideProtectedFileStep, shouldApplyStep } from '../core/step-helpers'
import type { AppContext, JsonValue, PackageJson } from '../core/types'
import { detectIndent } from '../core/utils'
import { typescriptRangeNeedsUpdate } from '../core/version'
import { discoverWorkspacePackages, formatWorkspacePackageJson, writeWorkspacePackageJson } from '../manifests/workspace-package-json'
import { runWorkspacePnpmAddAndRefresh } from './pnpm'


const singleFilePresetOptions = [ 'astro-workers', 'base', 'node', 'react', 'react-astro', 'react-astro-workers', 'react-native', 'react-lib', 'react-workers', 'workers' ] as const
type SingleFilePresetName = (typeof singleFilePresetOptions)[number]

const presetOptions = [ ...singleFilePresetOptions, 'workers-vitest' ] as const
type PresetName = (typeof presetOptions)[number]

const detectionRules: Array<{ preset: PresetName; markers: string[]; requires?: string[] }> = [
  { preset: 'react-native', markers: [ 'react-native', 'expo' ] },
  { preset: 'react-astro-workers', markers: [ 'astro', '@cloudflare/workers-types', 'wrangler' ], requires: [ 'react' ] },
  { preset: 'react-astro', markers: [ 'astro' ], requires: [ 'react' ] },
  { preset: 'react-workers', markers: [ '@cloudflare/workers-types', 'wrangler' ], requires: [ 'react' ] },
  { preset: 'react', markers: [ 'react', 'vite' ] },
  { preset: 'react-lib', markers: [ 'react' ] },
  { preset: 'astro-workers', markers: [ 'astro', '@cloudflare/workers-types', 'wrangler' ] },
  { preset: 'workers-vitest', markers: [ '@cloudflare/vitest-pool-workers', '@cloudflare/vitest-plugin' ] },
  { preset: 'workers', markers: [ '@cloudflare/workers-types', 'wrangler' ] }
]

const presetIncludes: Record<SingleFilePresetName, string[]> = {
  'astro-workers': [
    'src',
    'e2e',
    'scripts',
    'test',
    '*.ts'
  ],
  base: [
    'e2e',
    'scripts',
    'src',
    'types',
    'test',
    '*.ts'
  ],
  node: [ '**/*.ts' ],
  react: [
    'e2e',
    'scripts',
    'src',
    'test',
    '*.ts'
  ],
  'react-lib': [
    'e2e',
    'scripts',
    'src',
    'test',
    '*.ts'
  ],
  'react-astro': [
    'e2e',
    'scripts',
    'src',
    'test',
    '*.ts'
  ],
  'react-astro-workers': [
    'e2e',
    'scripts',
    'src',
    'test',
    '*.ts'
  ],
  'react-native': [
    'e2e',
    'scripts',
    'src',
    'test',
    '.expo/types/**/*.ts',
    'expo-env.d.ts',
    '*.ts'
  ],
  'react-workers': [
    'e2e',
    'scripts',
    'src',
    'test',
    '*.ts'
  ],
  workers: [
    'src',
    'e2e',
    'scripts',
    'test',
    '*.ts'
  ]
}

interface WorkersVitestTsconfigFile {
  relativePath: string
  extendsPath: string
  compilerOptions: Record<string, JsonValue>
  include: string[]
  references?: Array<{ path: string }>
}

const workersVitestFiles: WorkersVitestTsconfigFile[] = [
  {
    relativePath: 'tsconfig.json',
    extendsPath: '@comment-labs/tsconfig/workers-vitest',
    compilerOptions: {
      paths: {
        '#/*': [ './src/*' ]
      }
    },
    include: [ 'e2e', 'scripts', '*.ts' ],
    references: [
      { path: './tsconfig.app.json' },
      { path: './test/tsconfig.json' }
    ]
  },
  {
    relativePath: 'tsconfig.app.json',
    extendsPath: '@comment-labs/tsconfig/workers-vitest-app',
    compilerOptions: {
      paths: {
        '#/*': [ './src/*' ]
      },
      outDir: 'build/src',
      rootDir: 'src'
    },
    include: [ 'src' ]
  },
  {
    relativePath: 'test/tsconfig.json',
    extendsPath: '@comment-labs/tsconfig/workers-vitest-test',
    compilerOptions: {
      paths: {
        '#/*': [ '../src/*' ]
      },
      outDir: '../build/test'
    },
    include: [ '**/*', '*.ts', '../src/environment.d.ts' ],
    references: [
      { path: '../tsconfig.app.json' }
    ]
  }
]

export async function handlePackageTypescript(context: AppContext): Promise<void> {
  const packages = await discoverWorkspacePackages(context)

  for (const pkg of packages) {
    const tsRange = pkg.packageJson.devDependencies?.typescript
    if (typeof tsRange !== 'string') {
      continue
    }

    await maybeUpdateTypescriptRange(context, pkg, tsRange)

    const shouldEnsureTsconfig = await maybeEnsureTsconfigDependency(context, pkg)

    let preset: PresetName | null = null

    if (shouldEnsureTsconfig) {
      preset = await resolvePreset(context, pkg)
      await ensureTsconfig(context, pkg, preset)
    }

    await maybeEnsureTypecheckScript(context, pkg, preset)
  }
}

async function maybeUpdateTypescriptRange(context: AppContext, pkg: WorkspacePackage, range: string): Promise<void> {
  if (!typescriptRangeNeedsUpdate(range)) {
    return
  }

  const nextPackageJson = structuredClone(pkg.packageJson)
  nextPackageJson.devDependencies = {
    ...nextPackageJson.devDependencies,
    typescript: '6.0.2'
  }

  const decision = await askEphemeralStep(
    `Update ${pkg.dirName} TypeScript devDependency to ^6.0.0?`,
    context.autoApprove
  )
  if (decision === 'abort') {
    throw new Error(`Aborted while updating TypeScript for ${pkg.dirName}.`)
  }

  if (decision !== 'apply') {
    return
  }

  if (await writeWorkspacePackageJson(pkg, nextPackageJson)) {
    context.changedFiles.add(pkg.packageJsonPath)
  }
}

async function maybeEnsureTsconfigDependency(context: AppContext, pkg: WorkspacePackage): Promise<boolean> {
  if (typeof pkg.packageJson.devDependencies?.['@comment-labs/tsconfig'] === 'string') {
    return true
  }

  if (!(await shouldApplyStep(
    context,
    `packages.${pkg.dirName}.tsconfig.install`,
    `Install @comment-labs/tsconfig in ${pkg.dirName}?`,
    `Aborted while installing @comment-labs/tsconfig for ${pkg.dirName}.`
  ))) {
    return false
  }

  await runWorkspacePnpmAddAndRefresh(context, pkg, [ '-D', '@comment-labs/tsconfig@latest' ])

  return true
}

async function ensureTsconfig(context: AppContext, pkg: WorkspacePackage, preset: PresetName): Promise<void> {
  if (preset === 'workers-vitest') {
    await ensureWorkersVitestTsconfigs(context, pkg)

    return
  }

  await ensureSingleTsconfig(context, pkg, preset)
}

async function ensureSingleTsconfig(context: AppContext, pkg: WorkspacePackage, preset: SingleFilePresetName): Promise<void> {
  const tsconfigPath = path.join(pkg.dirPath, 'tsconfig.json')
  const hasTsconfig = await exists(tsconfigPath)
  if (!hasTsconfig) {
    const next = createTsconfigTemplate(preset)
    const decision = await decideFileStep(
      context,
      `packages.${pkg.dirName}.tsconfig.create`,
      `Create tsconfig.json for ${pkg.dirName}?`,
      `Aborted while creating tsconfig.json for ${pkg.dirName}.`,
      {
        title: `${pkg.dirName}/tsconfig.json`,
        before: '',
        after: next
      }
    )
    await applyFileDecision(context, decision, tsconfigPath, '', next)

    return
  }

  const current = await readFile(tsconfigPath, 'utf8')
  const proposed = createTsconfigTemplate(preset)
  const normalizedCurrent = normalizeTsconfigJson(current, preset)
  if (normalizedCurrent === proposed) {
    return
  }

  const decision = await decideProtectedFileStep(
    context,
    `packages.${pkg.dirName}.tsconfig.normalize`,
    `Update tsconfig.json in ${pkg.dirName} to add $schema and use an @comment-labs/tsconfig preset?`,
    `Aborted while updating tsconfig.json for ${pkg.dirName}.`,
    {
      title: `${pkg.dirName}/tsconfig.json`,
      before: current,
      after: proposed
    },
    false
  )
  await applyProtectedFileStep(context, `packages.${pkg.dirName}.tsconfig.normalize`, tsconfigPath, current, proposed, decision)
}

async function ensureWorkersVitestTsconfigs(context: AppContext, pkg: WorkspacePackage): Promise<void> {
  for (const file of workersVitestFiles) {
    const filePath = path.join(pkg.dirPath, file.relativePath)
    const keySuffix = file.relativePath.replaceAll('/', '.')
    const createKey = `packages.${pkg.dirName}.tsconfig.${keySuffix}.create`
    const normalizeKey = `packages.${pkg.dirName}.tsconfig.${keySuffix}.normalize`

    if (!(await exists(filePath))) {
      const next = createWorkersVitestTemplate(file)
      const decision = await decideFileStep(
        context,
        createKey,
        `Create ${file.relativePath} for ${pkg.dirName}?`,
        `Aborted while creating ${file.relativePath} for ${pkg.dirName}.`,
        {
          title: `${pkg.dirName}/${file.relativePath}`,
          before: '',
          after: next
        }
      )
      await applyFileDecision(context, decision, filePath, '', next)

      continue
    }

    const current = await readFile(filePath, 'utf8')
    const proposed = createWorkersVitestTemplate(file)
    const normalizedCurrent = normalizeWorkersVitestTsconfig(current, file)
    if (normalizedCurrent === proposed) {
      continue
    }

    const decision = await decideProtectedFileStep(
      context,
      normalizeKey,
      `Update ${file.relativePath} in ${pkg.dirName} to add $schema and use an @comment-labs/tsconfig preset?`,
      `Aborted while updating ${file.relativePath} for ${pkg.dirName}.`,
      {
        title: `${pkg.dirName}/${file.relativePath}`,
        before: current,
        after: proposed
      },
      false
    )
    await applyProtectedFileStep(context, normalizeKey, filePath, current, proposed, decision)
  }
}

function createWorkersVitestTemplate(file: WorkersVitestTsconfigFile): string {
  return `${JSON.stringify({
    $schema: 'https://json.schemastore.org/tsconfig',
    extends: [ file.extendsPath ],
    compilerOptions: file.compilerOptions,
    include: file.include,
    ...(file.references === undefined ? {} : { references: file.references })
  }, null, 2)}\n`
}

function normalizeWorkersVitestTsconfig(current: string, file: WorkersVitestTsconfigFile): string {
  let parsed: Record<string, unknown>

  try {
    const nextParsed: unknown = JSON.parse(current)
    if (!isUnknownRecord(nextParsed)) {
      return current
    }

    parsed = nextParsed
  } catch {
    return current
  }

  const existingCompilerOptions = isRecord(parsed.compilerOptions) ? parsed.compilerOptions : {}
  const existingPaths = isRecord(existingCompilerOptions.paths) ? existingCompilerOptions.paths : {}

  const next: Record<string, unknown> = {
    $schema: 'https://json.schemastore.org/tsconfig',
    ...parsed,
    extends: normalizeExtendsTo(parsed.extends, file.extendsPath),
    compilerOptions: {
      ...existingCompilerOptions,
      paths: {
        ...existingPaths,
        ...(file.compilerOptions.paths as Record<string, JsonValue>)
      }
    },
    include: file.include,
    ...(file.references === undefined ? {} : { references: file.references })
  }

  const newline = current.includes('\r\n') ? '\r\n' : '\n'
  const indent = detectIndent(current)

  return `${JSON.stringify(next, null, indent)}${newline}`
}

async function maybeEnsureTypecheckScript(context: AppContext, pkg: WorkspacePackage, preset: PresetName | null): Promise<void> {
  const command = preset === 'workers-vitest' ? 'tsc --build' : 'tsc'
  const current = pkg.packageJson.scripts?.typecheck
  if (current === command || current === 'tsc -b') {
    return
  }

  const nextPackageJson: PackageJson = structuredClone(pkg.packageJson)
  nextPackageJson.scripts = {
    ...nextPackageJson.scripts,
    typecheck: command
  }

  const decision = await decideFileStep(
    context,
    `packages.${pkg.dirName}.scripts.typecheck`,
    `Add a typecheck script to ${pkg.dirName}?`,
    `Aborted while updating typecheck script for ${pkg.dirName}.`,
    {
      title: `${pkg.dirName}/package.json`,
      before: formatWorkspacePackageJson(pkg, pkg.packageJson),
      after: formatWorkspacePackageJson(pkg, nextPackageJson)
    }
  )
  const before = formatWorkspacePackageJson(pkg, pkg.packageJson)
  const after = formatWorkspacePackageJson(pkg, nextPackageJson)
  if (decision !== 'apply') {
    await applyFileDecision(context, decision, pkg.packageJsonPath, before, after)

    return
  }

  if (await writeWorkspacePackageJson(pkg, nextPackageJson)) {
    context.changedFiles.add(pkg.packageJsonPath)
  }
}

function detectPreset(packageJson: PackageJson): PresetName | null {
  const allDependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.peerDependencies
  }

  for (const rule of detectionRules) {
    const markersMatch = rule.markers.some(marker => marker in allDependencies)
    const requiresMatch = rule.requires?.every(req => req in allDependencies) ?? true
    if (markersMatch && requiresMatch) {
      return rule.preset
    }
  }

  return null
}

async function resolvePreset(context: AppContext, pkg: WorkspacePackage): Promise<PresetName> {
  const detected = detectPreset(pkg.packageJson)
  if (detected) {
    const useDetected = await askStep(
      context,
      `packages.${pkg.dirName}.tsconfig.detectedPreset`,
      `Use detected tsconfig preset "${detected}" for ${pkg.dirName}?`
    )
    if (useDetected === 'abort') {
      throw new Error(`Aborted while choosing tsconfig preset for ${pkg.dirName}.`)
    }

    if (useDetected === 'apply') {
      return detected
    }
  }

  return await askSelect(
    context,
    `packages.${pkg.dirName}.tsconfig.preset`,
    `Select a tsconfig preset for ${pkg.dirName}`,
    presetOptions.map(preset => ({
      title: preset,
      value: preset
    })),
    detected ?? 'node'
  )
}

function createTsconfigTemplate(preset: SingleFilePresetName): string {
  return `${JSON.stringify({
    $schema: 'https://json.schemastore.org/tsconfig',
    extends: [ `@comment-labs/tsconfig/${preset}` ],
    compilerOptions: {
      paths: {
        '#/*': [ './src/*' ]
      }
    },
    include: presetIncludes[preset]
  }, null, 2)}\n`
}

function normalizeTsconfigJson(current: string, preset: SingleFilePresetName): string {
  let parsed: Record<string, unknown>

  try {
    const nextParsed: unknown = JSON.parse(current)
    if (!isUnknownRecord(nextParsed)) {
      return current
    }

    parsed = nextParsed
  } catch {
    return current
  }

  const next: Record<string, unknown> = {
    $schema: 'https://json.schemastore.org/tsconfig',
    ...parsed,
    extends: normalizeExtends(parsed.extends, preset),
    compilerOptions: normalizeCompilerOptions(parsed.compilerOptions),
    include: presetIncludes[preset]
  }

  const newline = current.includes('\r\n') ? '\r\n' : '\n'
  const indent = detectIndent(current)

  return `${JSON.stringify(next, null, indent)}${newline}`
}

function normalizeExtends(value: unknown, preset: SingleFilePresetName): string[] {
  return normalizeExtendsTo(value, `@comment-labs/tsconfig/${preset}`)
}

function normalizeExtendsTo(value: unknown, desired: string): string[] {
  if (Array.isArray(value)) {
    const filtered = value.filter((entry): entry is string => typeof entry === 'string' && !entry.startsWith('@comment-labs/tsconfig/'))

    return [ desired, ...filtered ]
  }

  if (typeof value === 'string') {
    return value.startsWith('@comment-labs/tsconfig/') ? [ desired ] : [ desired, value ]
  }

  return [ desired ]
}

function normalizeCompilerOptions(value: unknown): Record<string, JsonValue> {
  const existing = isRecord(value) ? structuredClone(value) : {}
  const existingPaths = isRecord(existing.paths) ? existing.paths : {}

  return {
    ...existing,
    paths: {
      ...existingPaths,
      '#/*': [ './src/*' ]
    }
  }
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
