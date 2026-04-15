import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { exists, trackWriteTextFileIfChanged } from '../core/filesystem'
import { askBoolean, askStep, askText } from '../core/prompts'
import { getPreference } from '../core/preferences'
import type { AppContext } from '../core/types'
import { codeownersTemplate } from '../templates/codeowners'


const ownerSplitPattern = /[\s,]+/

export async function handleCodeowners(context: AppContext): Promise<void> {
  if (context.git.githubRepo === null) {
    return
  }

  const enabled = await shouldRunCodeownersStep(context)
  if (enabled === 'abort') {
    throw new Error('Aborted before CODEOWNERS setup.')
  }

  if (!enabled) {
    return
  }

  const defaultOwners = `@${context.git.githubRepo.split('/')[0]}`
  const rootOwners = await askOwners(context, 'codeowners.root', 'Owners for *', defaultOwners)
  const entries: Array<{ pattern: string; owners: string }> = [{ pattern: '*', owners: rootOwners }]

  const packagesDir = path.join(context.cwd, 'packages')
  if (await exists(packagesDir)) {
    const packageEntries = await readdir(packagesDir, { withFileTypes: true })
    const packageDirs = packageEntries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort((left, right) => left.localeCompare(right))

    for (const packageDir of packageDirs) {
      const useDefault = await askStep(
        context,
        `codeowners.packages.${packageDir}.default`,
        `Use the default owners for /packages/${packageDir}/ in CODEOWNERS?`
      )
      if (useDefault === 'abort') {
        throw new Error(`Aborted while configuring CODEOWNERS for ${packageDir}.`)
      }

      // Only add entry if owners differ from root
      if (useDefault !== 'apply') {
        const owners = await askOwners(context, `codeowners.packages.${packageDir}.owners`, `Owners for /packages/${packageDir}/`, rootOwners)
        entries.push({
          pattern: `/packages/${packageDir}`,
          owners
        })
      }
    }
  }

  const codeownersPath = path.join(context.cwd, '.github', 'CODEOWNERS')
  const before = (await exists(codeownersPath)) ? await readFile(codeownersPath, 'utf8') : ''
  const after = codeownersTemplate(entries)
  if (before === after) {
    return
  }

  await trackWriteTextFileIfChanged(context, codeownersPath, after)
}

async function shouldRunCodeownersStep(context: AppContext): Promise<boolean | 'abort'> {
  const explicit = getPreference(context.preferences, 'codeowners.enabled')
  if (explicit === true || explicit === false) {
    return explicit
  }

  const legacy = getPreference(context.preferences, 'codeowners')
  if (legacy === true || legacy === false) {
    return legacy
  }

  const hasNestedSettings = typeof getPreference(context.preferences, 'codeowners.root') === 'string'
    || isObjectPreference(getPreference(context.preferences, 'codeowners.packages'))
  if (hasNestedSettings) {
    return true
  }

  return askBoolean(context, 'codeowners.enabled', 'Create or update .github/CODEOWNERS?')
}

async function askOwners(context: AppContext, key: string, message: string, initialValue: string): Promise<string> {
  const raw = await askText(context, key, message, initialValue)

  return normalizeOwners(raw)
}

function normalizeOwners(raw: string): string {
  return raw
    .split(ownerSplitPattern)
    .map(token => token.trim())
    .filter(token => token.length > 0)
    .map(token => (token.startsWith('@') ? token : `@${token}`))
    .join(' ')
}

function isObjectPreference(value: unknown): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
