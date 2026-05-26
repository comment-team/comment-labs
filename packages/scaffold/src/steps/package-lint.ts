import { readFile, unlink } from 'node:fs/promises'
import path from 'node:path'

import { applyFileDecision, exists } from '../core/filesystem'
import type { WorkspacePackage } from '../core/package-step'
import { askSelect } from '../core/prompts'
import { getPreference, persistPreferences, setPreference } from '../core/preferences'
import { applyProtectedFileStep, decideFileStep, decideProtectedFileStep, shouldApplyStep } from '../core/step-helpers'
import type { AppContext, PackageJson } from '../core/types'
import { discoverWorkspacePackages, formatWorkspacePackageJson, writeWorkspacePackageJson } from '../manifests/workspace-package-json'
import { eslintConfigTemplate, legacyBundledEslintReexport } from '../templates/eslint-config'
import { oxlintConfigTemplate } from '../templates/oxlint-config'
import { runWorkspacePnpmAddAndRefresh, runWorkspacePnpmRemoveAndRefresh } from './pnpm'


const eslintPackages = [ 'eslint', 'bundled-eslint-config', 'eslint-plugin-oxlint' ] as const
const oxlintPackages = [ 'oxlint', 'oxlint-tsgolint', '@comment-labs/oxlint-config' ] as const
const eslintConfigFiles = [ 'eslint.config.js', 'eslint.config.ts' ] as const
const oxlintConfigFiles = [ 'oxlint.config.ts' ] as const

const lintModeOptions = [ 'oxlint', 'oxlint-eslint', 'skip', 'remove-managed' ] as const
type LintMode = (typeof lintModeOptions)[number]


export async function handlePackageLint(context: AppContext): Promise<void> {
  const packages = await discoverWorkspacePackages(context)

  for (const pkg of packages) {
    if (!shouldConsiderLintSetup(pkg)) {
      continue
    }

    const mode = await resolveLintMode(context, pkg)

    switch (mode) {
      case 'oxlint':
        await maybeInstallOxlintDependencies(context, pkg)
        await maybeWriteOxlintConfig(context, pkg)
        await maybeRemoveEslint(context, pkg)
        await maybeUpdateLintScript(context, pkg, 'oxlint')
        break

      case 'oxlint-eslint':
        await maybeInstallOxlintDependencies(context, pkg)
        await maybeWriteOxlintConfig(context, pkg)
        await maybeInstallEslintDependencies(context, pkg)
        await maybeWriteEslintConfig(context, pkg)
        await maybeUpdateLintScript(context, pkg, 'oxlint && eslint --cache .')
        break

      case 'remove-managed':
        await maybeRemoveManagedLintSetup(context, pkg)
        break

      case 'skip':
        break
    }
  }
}

function shouldConsiderLintSetup(pkg: WorkspacePackage): boolean {
  return typeof pkg.packageJson.devDependencies?.typescript === 'string'
    || typeof pkg.packageJson.scripts?.build === 'string'
    || pkg.packageJson.name?.includes('eslint') === true
    || pkg.packageJson.name?.includes('oxlint') === true
}

async function resolveLintMode(context: AppContext, pkg: WorkspacePackage): Promise<LintMode> {
  const modeKey = `packages.${pkg.dirName}.lint.mode`
  const storedMode = getPreference(context.preferences, modeKey)
  if (isLintMode(storedMode)) {
    return storedMode
  }

  const legacyOxlintEnabled = getPreference(context.preferences, `packages.${pkg.dirName}.oxlint.enabled`)
  if (legacyOxlintEnabled === true) {
    const migratedMode = packageNeedsEslint(pkg) || hasEslintSetup(pkg)
      ? 'oxlint-eslint'
      : 'oxlint'
    await persistLintModePreference(context, modeKey, migratedMode)

    return migratedMode
  }

  if (legacyOxlintEnabled === false) {
    await persistLintModePreference(context, modeKey, 'skip')

    return 'skip'
  }

  return await askSelect(
    context,
    modeKey,
    `Select lint setup for ${pkg.dirName}`,
    [
      { title: 'Oxlint only', value: 'oxlint' },
      { title: 'Oxlint + ESLint', value: 'oxlint-eslint' },
      { title: 'Leave unchanged', value: 'skip' },
      { title: 'Remove managed lint setup', value: 'remove-managed' }
    ],
    defaultLintMode(pkg)
  )
}

function defaultLintMode(pkg: WorkspacePackage): LintMode {
  if (packageNeedsEslint(pkg) || hasEslintSetup(pkg)) {
    return 'oxlint-eslint'
  }

  return 'oxlint'
}

function isLintMode(value: unknown): value is LintMode {
  return typeof value === 'string' && lintModeOptions.some(mode => mode === value)
}

async function persistLintModePreference(context: AppContext, key: string, mode: LintMode): Promise<void> {
  context.preferences = setPreference(context.preferences, key, mode)
  await persistPreferences(context)
}

async function maybeInstallOxlintDependencies(context: AppContext, pkg: WorkspacePackage): Promise<void> {
  const devDependencies = pkg.packageJson.devDependencies ?? {}
  const hasAll = oxlintPackages.every(name => typeof devDependencies[name] === 'string')
  if (hasAll) {
    return
  }

  if (!(await shouldApplyStep(
    context,
    `packages.${pkg.dirName}.oxlint.install`,
    `Install oxlint dependencies in ${pkg.dirName}?`,
    `Aborted while installing oxlint dependencies for ${pkg.dirName}.`
  ))) {
    return
  }

  await runWorkspacePnpmAddAndRefresh(context, pkg, [
    '-D',
    ...oxlintPackages
  ])
}

async function maybeInstallEslintDependencies(context: AppContext, pkg: WorkspacePackage): Promise<void> {
  const devDependencies = pkg.packageJson.devDependencies ?? {}
  const hasAll = eslintPackages.every(name => typeof devDependencies[name] === 'string')
  if (hasAll) {
    return
  }

  if (!(await shouldApplyStep(
    context,
    `packages.${pkg.dirName}.eslint.install`,
    `Install eslint dependencies in ${pkg.dirName}?`,
    `Aborted while installing eslint dependencies for ${pkg.dirName}.`
  ))) {
    return
  }

  await runWorkspacePnpmAddAndRefresh(context, pkg, [
    '-D',
    ...eslintPackages
  ])
}

async function maybeRemoveEslint(context: AppContext, pkg: WorkspacePackage): Promise<void> {
  const installedPackages = eslintPackages.filter(name => typeof pkg.packageJson.devDependencies?.[name] === 'string')
  const existingFiles = await getExistingEslintConfigFiles(pkg)
  const lintScript = pkg.packageJson.scripts?.lint
  const hasEslintLintScript = typeof lintScript === 'string' && lintScript.includes('eslint')
  if (installedPackages.length === 0 && existingFiles.length === 0 && !hasEslintLintScript) {
    return
  }

  const decision = await decideFileStep(
    context,
    `packages.${pkg.dirName}.eslint.remove`,
    `Remove managed eslint setup from ${pkg.dirName} and use oxlint only?`,
    `Aborted while removing eslint from ${pkg.dirName}.`,
    {
      title: `${pkg.dirName}/package.json`,
      before: formatWorkspacePackageJson(pkg, pkg.packageJson),
      after: formatWorkspacePackageJson(pkg, withoutManagedLintDependencies(pkg.packageJson, eslintPackages, 'oxlint'))
    }
  )
  if (decision !== 'apply') {
    return
  }

  await removeManagedLintArtifacts(context, pkg, installedPackages, existingFiles, 'oxlint')
}

async function maybeRemoveManagedLintSetup(context: AppContext, pkg: WorkspacePackage): Promise<void> {
  const installedPackages = [
    ...oxlintPackages,
    ...eslintPackages
  ].filter(name => typeof pkg.packageJson.devDependencies?.[name] === 'string')
  const existingFiles = [
    ...await getExistingOxlintConfigFiles(pkg),
    ...await getExistingEslintConfigFiles(pkg)
  ]
  const lintScript = pkg.packageJson.scripts?.lint
  const hasManagedLintScript = typeof lintScript === 'string' && isManagedLintScript(lintScript)
  if (installedPackages.length === 0 && existingFiles.length === 0 && !hasManagedLintScript) {
    return
  }

  const nextPackageJson = withoutManagedLintDependencies(
    pkg.packageJson,
    installedPackages,
    hasManagedLintScript ? undefined : lintScript
  )
  const before = formatWorkspacePackageJson(pkg, pkg.packageJson)
  const after = formatWorkspacePackageJson(pkg, nextPackageJson)
  const decision = await decideFileStep(
    context,
    `packages.${pkg.dirName}.lint.removeManaged`,
    `Remove managed lint setup from ${pkg.dirName}?`,
    `Aborted while removing managed lint setup from ${pkg.dirName}.`,
    {
      title: `${pkg.dirName}/package.json`,
      before,
      after
    }
  )
  if (decision !== 'apply') {
    await applyFileDecision(
      context,
      decision,
      pkg.packageJsonPath,
      before,
      after
    )

    return
  }

  await removeManagedLintArtifacts(
    context,
    pkg,
    installedPackages,
    existingFiles,
    hasManagedLintScript ? undefined : lintScript
  )
}

async function removeManagedLintArtifacts(
  context: AppContext,
  pkg: WorkspacePackage,
  packageNames: string[],
  filePaths: string[],
  nextLintScript?: string
): Promise<void> {
  if (packageNames.length > 0) {
    await runWorkspacePnpmRemoveAndRefresh(context, pkg, packageNames)
  }

  for (const filePath of filePaths) {
    await unlink(filePath)
    context.changedFiles.add(filePath)
  }

  const nextPackageJson = withoutManagedLintDependencies(pkg.packageJson, packageNames, nextLintScript)
  if (await writeWorkspacePackageJson(pkg, nextPackageJson)) {
    context.changedFiles.add(pkg.packageJsonPath)
  }
}

async function maybeWriteOxlintConfig(context: AppContext, pkg: WorkspacePackage): Promise<void> {
  const filePath = path.join(pkg.dirPath, 'oxlint.config.ts')
  const before = (await exists(filePath)) ? await readFile(filePath, 'utf8') : ''
  const proposed = oxlintConfigTemplate()
  const normalizedBefore = normalizeScaffoldedFile(before)
  const normalizedProposed = normalizeScaffoldedFile(proposed)
  if (normalizedBefore === normalizedProposed) {
    return
  }

  const decision = await decideProtectedFileStep(
    context,
    `packages.${pkg.dirName}.oxlint.config`,
    `Write oxlint.config.ts for ${pkg.dirName}?`,
    `Aborted while updating oxlint config for ${pkg.dirName}.`,
    {
      title: `${pkg.dirName}/oxlint.config.ts`,
      before,
      after: proposed
    },
    before.trim().length === 0
  )
  await applyProtectedFileStep(context, `packages.${pkg.dirName}.oxlint.config`, filePath, before, proposed, decision)
}

async function maybeWriteEslintConfig(context: AppContext, pkg: WorkspacePackage): Promise<void> {
  const filePath = path.join(pkg.dirPath, 'eslint.config.js')
  const before = (await exists(filePath)) ? await readFile(filePath, 'utf8') : ''
  const proposed = eslintConfigTemplate()
  const normalizedBefore = normalizeScaffoldedFile(before)
  const normalizedProposed = normalizeScaffoldedFile(proposed)
  if (normalizedBefore === normalizedProposed) {
    return
  }

  const canReplace = before.trim().length === 0 || before.trim() === legacyBundledEslintReexport
  const decision = await decideProtectedFileStep(
    context,
    `packages.${pkg.dirName}.eslint.config`,
    `Write eslint.config.js for ${pkg.dirName}?`,
    `Aborted while updating eslint config for ${pkg.dirName}.`,
    {
      title: `${pkg.dirName}/eslint.config.js`,
      before,
      after: proposed
    },
    canReplace
  )
  await applyProtectedFileStep(context, `packages.${pkg.dirName}.eslint.config`, filePath, before, proposed, decision)
}

async function maybeUpdateLintScript(context: AppContext, pkg: WorkspacePackage, lintCommand: string): Promise<void> {
  if (pkg.packageJson.scripts?.lint === lintCommand) {
    return
  }

  const nextPackageJson: PackageJson = structuredClone(pkg.packageJson)
  nextPackageJson.scripts = {
    ...nextPackageJson.scripts,
    lint: lintCommand
  }

  const before = formatWorkspacePackageJson(pkg, pkg.packageJson)
  const after = formatWorkspacePackageJson(pkg, nextPackageJson)
  const decision = await decideFileStep(
    context,
    `packages.${pkg.dirName}.scripts.lint`,
    `Update the lint script in ${pkg.dirName}?`,
    `Aborted while updating lint script for ${pkg.dirName}.`,
    {
      title: `${pkg.dirName}/package.json`,
      before,
      after
    }
  )

  if (decision !== 'apply') {
    await applyFileDecision(context, decision, pkg.packageJsonPath, before, after)

    return
  }

  if (await writeWorkspacePackageJson(pkg, nextPackageJson)) {
    context.changedFiles.add(pkg.packageJsonPath)
  }
}

function normalizeScaffoldedFile(content: string): string {
  if (content.length === 0) {
    return ''
  }

  return content.endsWith('\n') ? content : `${content}\n`
}

function packageNeedsEslint(pkg: WorkspacePackage): boolean {
  const allDependencies = {
    ...pkg.packageJson.dependencies,
    ...pkg.packageJson.devDependencies,
    ...pkg.packageJson.peerDependencies
  }

  return typeof allDependencies.astro === 'string' || typeof allDependencies.vue === 'string'
}

function hasEslintSetup(pkg: WorkspacePackage): boolean {
  return eslintPackages.some(name => typeof pkg.packageJson.devDependencies?.[name] === 'string')
    || (typeof pkg.packageJson.scripts?.lint === 'string' && pkg.packageJson.scripts.lint.includes('eslint'))
}

function withoutManagedLintDependencies(
  packageJson: PackageJson,
  packageNames: readonly string[],
  nextLintScript?: string
): PackageJson {
  const nextPackageJson: PackageJson = structuredClone(packageJson)
  const packageNamesToRemove = new Set(packageNames)
  const devDependencies = Object.fromEntries(
    Object.entries(nextPackageJson.devDependencies ?? {})
      .filter(([ packageName ]) => !packageNamesToRemove.has(packageName))
  )

  nextPackageJson.devDependencies = devDependencies
  if (Object.keys(devDependencies).length === 0) {
    delete nextPackageJson.devDependencies
  }

  if (nextLintScript === undefined) {
    if (nextPackageJson.scripts) {
      delete nextPackageJson.scripts.lint
      if (Object.keys(nextPackageJson.scripts).length === 0) {
        delete nextPackageJson.scripts
      }
    }
  } else {
    nextPackageJson.scripts = {
      ...nextPackageJson.scripts,
      lint: nextLintScript
    }
  }

  return nextPackageJson
}

function isManagedLintScript(value: string): boolean {
  return value === 'oxlint' || value === 'oxlint && eslint --cache .' || value.includes('eslint')
}

async function getExistingOxlintConfigFiles(pkg: WorkspacePackage): Promise<string[]> {
  const results: string[] = []

  for (const fileName of oxlintConfigFiles) {
    const filePath = path.join(pkg.dirPath, fileName)
    if (await exists(filePath)) {
      results.push(filePath)
    }
  }

  return results
}

async function getExistingEslintConfigFiles(pkg: WorkspacePackage): Promise<string[]> {
  const results: string[] = []

  for (const fileName of eslintConfigFiles) {
    const filePath = path.join(pkg.dirPath, fileName)
    if (await exists(filePath)) {
      results.push(filePath)
    }
  }

  return results
}
