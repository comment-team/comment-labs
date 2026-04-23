import { readFile, unlink } from 'node:fs/promises'
import path from 'node:path'

import { applyFileDecision, exists } from '../core/filesystem'
import type { WorkspacePackage } from '../core/package-step'
import { askEphemeralStep, askStep } from '../core/prompts'
import { applyProtectedFileStep, decideFileStep, decideProtectedFileStep, shouldApplyStep } from '../core/step-helpers'
import type { AppContext, PackageJson } from '../core/types'
import { discoverWorkspacePackages, formatWorkspacePackageJson, refreshWorkspacePackage, writeWorkspacePackageJson } from '../manifests/workspace-package-json'
import { eslintConfigTemplate, legacyBundledEslintReexport } from '../templates/eslint-config'
import { oxlintConfigTemplate } from '../templates/oxlint-config'
import { runPnpmAdd, runPnpmRemove } from './pnpm'


const eslintPackages = [ 'eslint', 'bundled-eslint-config', 'eslint-plugin-oxlint' ] as const
const eslintConfigFiles = [ 'eslint.config.js', 'eslint.config.ts' ] as const


export async function handlePackageLint(context: AppContext): Promise<void> {
  const packages = await discoverWorkspacePackages(context.cwd)

  for (const pkg of packages) {
    if (!shouldConsiderLintSetup(pkg)) {
      continue
    }

    const wantsOxlint = await askBooleanLikeStep(
      context,
      `packages.${pkg.dirName}.oxlint.enabled`,
      `Set up oxlint for ${pkg.dirName}?`,
      `Aborted while deciding oxlint setup for ${pkg.dirName}.`
    )
    if (wantsOxlint) {
      await maybeInstallOxlintDependencies(context, pkg)
      await maybeWriteOxlintConfig(context, pkg)
    }

    if (!packageNeedsEslint(pkg)) {
      await maybeRemoveEslint(context, pkg)
      continue
    }

    await maybeInstallEslintDependencies(context, pkg)
    await maybeWriteEslintConfig(context, pkg)
    await maybeUpdateLintScript(context, pkg, 'oxlint && eslint --cache .')
  }
}

function shouldConsiderLintSetup(pkg: WorkspacePackage): boolean {
  return typeof pkg.packageJson.devDependencies?.typescript === 'string'
    || typeof pkg.packageJson.scripts?.build === 'string'
    || pkg.packageJson.name?.includes('eslint') === true
    || pkg.packageJson.name?.includes('oxlint') === true
}

async function maybeInstallOxlintDependencies(context: AppContext, pkg: WorkspacePackage): Promise<void> {
  const devDependencies = pkg.packageJson.devDependencies ?? {}
  const hasAll = typeof devDependencies.oxlint === 'string'
    && typeof devDependencies['oxlint-tsgolint'] === 'string'
    && typeof devDependencies['@comment-labs/oxlint-config'] === 'string'
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

  runPnpmAdd(pkg.dirPath, [
    '-D',
    'oxlint',
    'oxlint-tsgolint',
    '@comment-labs/oxlint-config'
  ])
  await refreshWorkspacePackage(pkg)
}

async function maybeInstallEslintDependencies(context: AppContext, pkg: WorkspacePackage): Promise<void> {
  const devDependencies = pkg.packageJson.devDependencies ?? {}
  const hasAll = typeof devDependencies.eslint === 'string'
    && typeof devDependencies['bundled-eslint-config'] === 'string'
    && typeof devDependencies['eslint-plugin-oxlint'] === 'string'
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

  runPnpmAdd(pkg.dirPath, [
    '-D',
    'eslint',
    'bundled-eslint-config',
    'eslint-plugin-oxlint'
  ])
  await refreshWorkspacePackage(pkg)
}

async function maybeRemoveEslint(context: AppContext, pkg: WorkspacePackage): Promise<void> {
  const installedPackages = eslintPackages.filter(name => typeof pkg.packageJson.devDependencies?.[name] === 'string')
  const existingFiles = await getExistingEslintConfigFiles(pkg)
  const lintScript = pkg.packageJson.scripts?.lint
  const hasEslintLintScript = typeof lintScript === 'string' && lintScript !== 'oxlint'
  if (installedPackages.length === 0 && existingFiles.length === 0 && !hasEslintLintScript) {
    return
  }

  const decision = await askEphemeralStep(
    `Remove eslint setup from ${pkg.dirName} and use oxlint only?`,
    context.autoApprove
  )
  if (decision === 'abort') {
    throw new Error(`Aborted while removing eslint from ${pkg.dirName}.`)
  }

  if (decision !== 'apply') {
    return
  }

  if (installedPackages.length > 0) {
    runPnpmRemove(pkg.dirPath, [ ...installedPackages ])
    await refreshWorkspacePackage(pkg)
  }

  for (const filePath of existingFiles) {
    await unlink(filePath)
    context.changedFiles.add(filePath)
  }

  if (lintScript !== 'oxlint') {
    const nextPackageJson: PackageJson = structuredClone(pkg.packageJson)
    nextPackageJson.scripts = {
      ...nextPackageJson.scripts,
      lint: 'oxlint'
    }

    if (await writeWorkspacePackageJson(pkg, nextPackageJson)) {
      context.changedFiles.add(pkg.packageJsonPath)
    }
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

async function askBooleanLikeStep(
  context: AppContext,
  key: string,
  message: string,
  abortMessage: string
): Promise<boolean> {
  const decision = await askStep(context, key, message)
  if (decision === 'abort') {
    throw new Error(abortMessage)
  }

  return decision === 'apply'
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
