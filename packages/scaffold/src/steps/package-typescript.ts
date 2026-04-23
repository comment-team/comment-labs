import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { applyFileDecision, exists } from '../core/filesystem'
import type { WorkspacePackage } from '../core/package-step'
import { askEphemeralStep, askSelect, askStep } from '../core/prompts'
import { applyProtectedFileStep, decideFileStep, decideProtectedFileStep, shouldApplyStep } from '../core/step-helpers'
import type { AppContext, JsonValue, PackageJson } from '../core/types'
import { detectIndent } from '../core/utils'
import { typescriptRangeNeedsUpdate } from '../core/version'
import { discoverWorkspacePackages, formatWorkspacePackageJson, refreshWorkspacePackage, writeWorkspacePackageJson } from '../manifests/workspace-package-json'
import { runPnpmAdd } from './pnpm'


const presetOptions = [ 'base', 'node', 'react', 'react-native', 'workers' ] as const
type PresetName = (typeof presetOptions)[number]

const detectionRules: Array<{ preset: PresetName; markers: string[] }> = [
  { preset: 'react', markers: [ 'react', 'vite' ] },
  { preset: 'react-native', markers: [ 'react-native', 'expo' ] },
  { preset: 'workers', markers: [ '@cloudflare/workers-types', 'wrangler' ] }
]

const presetIncludes: Record<PresetName, string[]> = {
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
  'react-native': [
    'e2e',
    'scripts',
    'src',
    'test',
    '.expo/types',
    'expo-env.d.ts',
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

export async function handlePackageTypescript(context: AppContext): Promise<void> {
  const packages = await discoverWorkspacePackages(context.cwd)

  for (const pkg of packages) {
    const tsRange = pkg.packageJson.devDependencies?.typescript
    if (typeof tsRange !== 'string') {
      continue
    }

    await maybeUpdateTypescriptRange(context, pkg, tsRange)
    await maybeEnsureTsconfigDependency(context, pkg)
    await maybeEnsureTsconfig(context, pkg)
    await maybeEnsureTypecheckScript(context, pkg)
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

async function maybeEnsureTsconfigDependency(context: AppContext, pkg: WorkspacePackage): Promise<void> {
  if (typeof pkg.packageJson.devDependencies?.['@comment-labs/tsconfig'] === 'string') {
    return
  }

  if (!(await shouldApplyStep(
    context,
    `packages.${pkg.dirName}.tsconfig.install`,
    `Install @comment-labs/tsconfig in ${pkg.dirName}?`,
    `Aborted while installing @comment-labs/tsconfig for ${pkg.dirName}.`
  ))) {
    return
  }

  runPnpmAdd(pkg.dirPath, [ '-D', '@comment-labs/tsconfig' ])
  await refreshWorkspacePackage(pkg)
}

async function maybeEnsureTsconfig(context: AppContext, pkg: WorkspacePackage): Promise<void> {
  const preset = await resolvePreset(context, pkg)
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

async function maybeEnsureTypecheckScript(context: AppContext, pkg: WorkspacePackage): Promise<void> {
  const current = pkg.packageJson.scripts?.typecheck
  if (current === 'tsc') {
    return
  }

  const nextPackageJson: PackageJson = structuredClone(pkg.packageJson)
  nextPackageJson.scripts = {
    ...nextPackageJson.scripts,
    typecheck: 'tsc'
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
    if (rule.markers.some(marker => marker in allDependencies)) {
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

  return askSelect(
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

function createTsconfigTemplate(preset: PresetName): string {
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

function normalizeTsconfigJson(current: string, preset: PresetName): string {
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

function normalizeExtends(value: unknown, preset: PresetName): string[] {
  const desired = `@comment-labs/tsconfig/${preset}`

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
