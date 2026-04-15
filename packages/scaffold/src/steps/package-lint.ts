import path from 'node:path'
import { readFile } from 'node:fs/promises'
import process from 'node:process'

import { applyFileDecision, exists } from '../core/filesystem'
import type { WorkspacePackage } from '../core/package-step'
import { renderDiffPreview } from '../core/diff'
import { askStep, runSelectPrompt } from '../core/prompts'
import { getPreference, persistPreferences, setPreference } from '../core/preferences'
import { decideFileStep, shouldApplyStep } from '../core/step-helpers'
import type { AppContext, PackageJson, StepDecision } from '../core/types'
import { detectIndent, isPackageJson } from '../core/utils'
import { discoverWorkspacePackages, formatWorkspacePackageJson, writeWorkspacePackageJson } from '../manifests/workspace-package-json'
import { eslintConfigTemplate, legacyBundledEslintReexport } from '../templates/eslint-config'
import { oxlintConfigTemplate } from '../templates/oxlint-config'
import { runPnpmAdd } from './pnpm'


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

    const wantsEslint = await askBooleanLikeStep(
      context,
      `packages.${pkg.dirName}.eslint.enabled`,
      `Set up eslint for ${pkg.dirName}?`,
      `Aborted while deciding eslint setup for ${pkg.dirName}.`
    )
    if (!wantsEslint) {
      continue
    }

    await maybeInstallEslintDependencies(context, pkg)
    await maybeWriteEslintConfig(context, pkg)
    await maybeUpdateLintScript(context, pkg)
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
    '@comment-labs/oxlint-config@workspace:*'
  ])
  await refreshWorkspacePackageState(pkg)
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
  await refreshWorkspacePackageState(pkg)
}

async function maybeWriteOxlintConfig(context: AppContext, pkg: WorkspacePackage): Promise<void> {
  const filePath = path.join(pkg.dirPath, 'oxlint.config.ts')
  const before = (await exists(filePath)) ? await readFile(filePath, 'utf8') : ''
  const after = oxlintConfigTemplate()
  const normalizedBefore = normalizeScaffoldedFile(before)
  const normalizedAfter = normalizeScaffoldedFile(after)
  if (normalizedBefore === normalizedAfter) {
    return
  }

  const decision = await decideConfigFileDecision(
    context,
    `packages.${pkg.dirName}.oxlint.config`,
    `Write oxlint.config.ts for ${pkg.dirName}?`,
    `Aborted while updating oxlint config for ${pkg.dirName}.`,
    {
      title: `${pkg.dirName}/oxlint.config.ts`,
      before,
      after: normalizedAfter
    },
    before.trim().length === 0
  )
  await applyConfigDecision(context, decision, filePath, before, normalizedAfter)
}

async function maybeWriteEslintConfig(context: AppContext, pkg: WorkspacePackage): Promise<void> {
  const filePath = path.join(pkg.dirPath, 'eslint.config.js')
  const before = (await exists(filePath)) ? await readFile(filePath, 'utf8') : ''
  const after = eslintConfigTemplate()
  const normalizedBefore = normalizeScaffoldedFile(before)
  const normalizedAfter = normalizeScaffoldedFile(after)
  if (normalizedBefore === normalizedAfter) {
    return
  }

  const canReplace = before.trim().length === 0 || before.trim() === legacyBundledEslintReexport
  const decision = await decideConfigFileDecision(
    context,
    `packages.${pkg.dirName}.eslint.config`,
    `Write eslint.config.js for ${pkg.dirName}?`,
    `Aborted while updating eslint config for ${pkg.dirName}.`,
    {
      title: `${pkg.dirName}/eslint.config.js`,
      before,
      after: normalizedAfter
    },
    canReplace
  )
  await applyConfigDecision(context, decision, filePath, before, normalizedAfter)
}

async function maybeUpdateLintScript(context: AppContext, pkg: WorkspacePackage): Promise<void> {
  if (pkg.packageJson.scripts?.lint === 'oxlint && eslint --cache .') {
    return
  }

  const nextPackageJson: PackageJson = structuredClone(pkg.packageJson)
  nextPackageJson.scripts = {
    ...nextPackageJson.scripts,
    lint: 'oxlint && eslint --cache .'
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

async function decideConfigFileDecision(
  context: AppContext,
  key: string,
  message: string,
  abortMessage: string,
  preview: {
    title: string
    before: string
    after: string
  },
  allowApply: boolean
): Promise<StepDecision> {
  const stored = getPreference(context.preferences, key)
  if (stored === 'merge') {
    return 'merge'
  }

  if (stored === false) {
    return 'skip'
  }

  if (allowApply) {
    return decideFileStep(context, key, message, abortMessage, preview)
  }

  if (context.autoApprove) {
    throw new Error(`Missing saved scaffold preference for "${key}" while running with --verify.`)
  }

  const choice = await promptManualMergeOnly(context, key, message, preview)
  if (choice === 'abort') {
    throw new Error(abortMessage)
  }

  return choice
}

async function promptManualMergeOnly(
  context: AppContext,
  key: string,
  message: string,
  preview: {
    title: string
    before: string
    after: string
  }
): Promise<StepDecision> {
  process.stdout.write(`\n${renderDiffPreview(preview.title, preview.before, preview.after)}\n`)

  const { decision } = await runSelectPrompt({
    type: 'select',
    name: 'decision',
    message: `${message} Existing file differs, so scaffold will not overwrite it automatically.`,
    choices: [
      { title: 'Merge manually', value: 'merge' },
      { title: 'Skip', value: 'skip' },
      { title: 'Abort', value: 'abort' }
    ],
    initial: 0
  })

  if (decision === 'merge' || decision === 'skip') {
    context.preferences = setPreference(context.preferences, key, decision === 'merge' ? 'merge' : false)
    await persistPreferences(context)
  }

  return decision
}

async function applyConfigDecision(
  context: AppContext,
  decision: StepDecision,
  filePath: string,
  before: string,
  after: string
): Promise<void> {
  if (decision === 'skip') {
    return
  }

  await applyFileDecision(context, decision, filePath, before, after)
}

async function refreshWorkspacePackageState(pkg: WorkspacePackage): Promise<void> {
  const raw = await readFile(pkg.packageJsonPath, 'utf8')
  const parsed = parsePackageJson(raw)
  if (!parsed) {
    throw new Error(`Invalid package.json in ${pkg.packageJsonPath}.`)
  }

  pkg.packageJson = parsed
  pkg.indent = detectIndent(raw)
  pkg.newline = raw.includes('\r\n') ? '\r\n' : '\n'
}

function parsePackageJson(raw: string): PackageJson | null {
  const parsed: unknown = JSON.parse(raw)

  return isPackageJson(parsed) ? parsed : null
}

function normalizeScaffoldedFile(content: string): string {
  if (content.length === 0) {
    return ''
  }

  return content.endsWith('\n') ? content : `${content}\n`
}
