#!/usr/bin/env node
import path from 'node:path'
import process from 'node:process'

import { getGitContext } from './core/git'
import { logError, logInfo, logSuccess, logWarn } from './core/log'
import { cancelled } from './core/prompts'
import { persistPreferences, readPreferences } from './core/preferences'
import type { AppContext } from './core/types'
import { readPackageJson } from './manifests/root-package-json'
import { handleCodeowners } from './steps/codeowners'
import { handleEmptyFolder } from './steps/empty-folder'
import { handleEditorConfig, handleGitattributes, handleGitignore, handleRenovate } from './steps/git-files'
import { handleKnip } from './steps/knip'
import { handleNpmrc } from './steps/npmrc'
import { handlePackageLint } from './steps/package-lint'
import { handleWorkspacePackageJsonSchema } from './steps/package-manifests'
import { handlePackageJson } from './steps/package-json'
import { handlePackageTypescript } from './steps/package-typescript'
import { handleChangesets, handlePnpmPlugin } from './steps/pnpm'
import { handleWorkspace, inferMonorepo } from './steps/workspace'


async function main(): Promise<void> {
  let context: AppContext | null = null

  try {
    const cwd = process.cwd()
    const autoApprove = process.env.CI !== undefined || process.argv.includes('--verify')
    const git = getGitContext(cwd)
    const preferenceState = await readPreferences(cwd, git)
    const packageJsonPath = path.join(cwd, 'package.json')
    const packageState = await readPackageJson(packageJsonPath)

    context = {
      cwd,
      autoApprove,
      git,
      preferencesPath: preferenceState.path,
      packageJsonPath,
      packageJson: packageState.json,
      packageJsonIndent: packageState.indent,
      packageJsonNewline: packageState.newline,
      preferences: preferenceState.preferences,
      changedFiles: new Set<string>(),
      persistPreferencesOnExit: true
    }

    await handleEmptyFolder(context)
    await handlePackageJson(context)
    await handleRenovate(context)
    await handleGitignore(context)
    await handleGitattributes(context)
    await handleEditorConfig(context)

    const monorepo = await inferMonorepo(context)
    await handleWorkspace(context, monorepo)
    await handleCodeowners(context)
    await handlePnpmPlugin(context)
    await handleChangesets(context)
    await handleKnip(context)
    await handleNpmrc(context)
    await handleWorkspacePackageJsonSchema(context)
    await handlePackageTypescript(context)
    await handlePackageLint(context)

    if (context.changedFiles.size === 0) {
      logInfo('No changes were applied.')

      return
    }

    logSuccess(`Updated ${context.changedFiles.size} file${context.changedFiles.size === 1 ? '' : 's'}.`)

    for (const file of context.changedFiles) {
      process.stdout.write(`- ${path.relative(context.cwd, file) || path.basename(file)}\n`)
    }
  } catch (error) {
    if (context?.persistPreferencesOnExit === true && Object.keys(context.preferences).length > 0) {
      try {
        await persistPreferences(context)
      } catch (persistError) {
        if (persistError instanceof Error) {
          logError(`Failed to persist scaffold preferences: ${persistError.message}`)
        }
      }
    }

    if (error === cancelled) {
      logWarn('Cancelled.')
      process.exitCode = 1

      return
    }

    if (error instanceof Error) {
      logError(error.message)
      process.exitCode = 1

      return
    }

    logError('Unknown error.')
    process.exitCode = 1
  }
}

await main()
