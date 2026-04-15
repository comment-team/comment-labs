import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { applyFileDecision, exists } from '../core/filesystem'
import { logInfo } from '../core/log'
import { askSelect } from '../core/prompts'
import { decideFileStep, shouldApplyStep } from '../core/step-helpers'
import type { AppContext } from '../core/types'
import { changesetConfigTemplate } from '../templates/changesets'


const COMMAND_TIMEOUT_MS = 60_000
const pluginPackageName = '@comment-labs/pnpm-plugin-defaults'

export async function handlePnpmPlugin(context: AppContext): Promise<void> {
  if (usesPluginDefaults(context)) {
    return
  }

  if (!(await shouldApplyStep(context, 'pnpm-plugin.install', 'Install the pnpm defaults plugin in the root package?', 'Aborted before pnpm plugin installation.'))) {
    return
  }

  runPnpmAdd(context.cwd, [ '--config', pluginPackageName ])
}

export async function handleChangesets(context: AppContext): Promise<void> {
  if (!(await shouldApplyStep(context, 'changesets.install', 'Install and configure Changesets?', 'Aborted before changesets setup.'))) {
    return
  }

  const accessDecision = await askSelect(
    context,
    'changesets.access',
    'Select package access for Changesets',
    [
      { title: 'Public', value: 'public' },
      { title: 'Private', value: 'restricted' }
    ],
    'public'
  )
  const changelogRepo = context.git.githubRepo ?? undefined
  const changesetsConfigPath = path.join(context.cwd, '.changeset', 'config.json')
  const changesetReadmePath = path.join(context.cwd, '.changeset', 'README.md')

  if (needsChangesetsInstall(context, changelogRepo)) {
    runPnpmAdd(context.cwd, [
      '-D',
      '@changesets/cli',
      ...(changelogRepo !== undefined ? [ '@changesets/changelog-github' ] : [])
    ])
  }

  if (!(await exists(changesetReadmePath))) {
    runPnpmCommand(context.cwd, [ 'changeset', 'init' ])
  }

  const changesetsPackageVersion = getInstalledPackageVersion(context.cwd, '@changesets/config')

  const before = (await exists(changesetsConfigPath)) ? await readFile(changesetsConfigPath, 'utf8') : ''
  const after = changesetConfigTemplate({
    access: accessDecision,
    baseBranch: context.git.baseBranch ?? 'main',
    changelogRepo,
    packageVersion: changesetsPackageVersion
  })
  const decision = await decideFileStep(
    context,
    'changesets.config',
    'Write .changeset/config.json?',
    'Aborted before writing changesets config.',
    {
      title: '.changeset/config.json',
      before,
      after
    }
  )
  await applyFileDecision(context, decision, changesetsConfigPath, before, after)
}

export function usesPluginDefaults(context: AppContext): boolean {
  return typeof context.packageJson?.configDependencies?.[pluginPackageName] === 'string'
}

function needsChangesetsInstall(context: AppContext, changelogRepo?: string): boolean {
  const devDependencies = context.packageJson?.devDependencies ?? {}
  const hasCli = typeof devDependencies['@changesets/cli'] === 'string'
  const hasGithubChangelog = typeof devDependencies['@changesets/changelog-github'] === 'string'

  return !hasCli || (changelogRepo !== undefined && !hasGithubChangelog)
}

export function runPnpmAdd(cwd: string, args: string[]): void {
  logInfo(`Installing with pnpm add --save-exact ${args.join(' ')} in ${path.relative(process.cwd(), cwd) || '.'}`)

  try {
    execFileSync('pnpm', [ 'add', '--save-exact', ...args ], { cwd, stdio: 'inherit', timeout: COMMAND_TIMEOUT_MS })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    throw new Error(`pnpm add failed: ${message}`, { cause: error })
  }
}

function runPnpmCommand(cwd: string, args: string[]): void {
  try {
    execFileSync('pnpm', args, { cwd, stdio: 'inherit', timeout: COMMAND_TIMEOUT_MS })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    throw new Error(`pnpm ${args.join(' ')} failed: ${message}`, { cause: error })
  }
}

export function getInstalledPackageVersion(cwd: string, packageName: string): string {
  try {
    const stdout = execFileSync('pnpm', [ 'why', packageName, '--json' ], { cwd, encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS })
    const parsed = parseWhyEntries(stdout)
    const version = parsed.find(entry => typeof entry.version === 'string' && entry.version.length > 0)?.version
    if (typeof version === 'string') {
      return version
    }
  } catch {
    // Ignore transient failures from `pnpm why` and fall through to the final error.
  }

  throw new Error(`Unable to determine installed version for ${packageName} using pnpm why.`)
}

function parseWhyEntries(raw: string): Array<{ version?: string }> {
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) {
    return []
  }

  return parsed.flatMap(entry => {
    if (!isVersionEntry(entry)) {
      return []
    }

    return [{ version: entry.version }]
  })
}

function isVersionEntry(value: unknown): value is { version?: string } {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
