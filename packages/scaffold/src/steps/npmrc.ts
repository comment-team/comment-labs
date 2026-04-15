import { readFile, unlink } from 'node:fs/promises'
import path from 'node:path'

import { applyFileDecision, exists } from '../core/filesystem'
import { askEphemeralStep } from '../core/prompts'
import { decideFileStep } from '../core/step-helpers'
import type { AppContext } from '../core/types'
import { usesPluginDefaults } from './pnpm'


const redundantNpmrcSettings = new Map<string, string>([
  [ 'block-exotic-subdeps', 'true' ],
  [ 'dedupe-peer-dependents', 'true' ],
  [ 'enable-global-virtual-store', 'true' ],
  [ 'enable-pre-post-scripts', 'true' ],
  [ 'hoist', 'false' ],
  [ 'ignore-patch-failures', 'false' ],
  [ 'minimum-release-age', '4320' ],
  [ 'optimistic-repeat-install', 'true' ],
  [ 'resolve-peers-from-workspace-root', 'false' ],
  [ 'save-exact', 'true' ],
  [ 'shell-emulator', 'true' ],
  [ 'shamefully-hoist', 'false' ],
  [ 'strict-peer-dependencies', 'true' ],
  [ 'trust-policy', 'no-downgrade' ],
  [ 'verify-deps-before-run', 'warn' ]
])
const trailingNewlinesPattern = /\n+$/

export async function handleNpmrc(context: AppContext): Promise<void> {
  const npmrcPath = path.join(context.cwd, '.npmrc')
  if (!(await exists(npmrcPath))) {
    return
  }

  const raw = await readFile(npmrcPath, 'utf8')
  if (raw.trim().length === 0) {
    const deleteDecision = await askEphemeralStep('Delete the empty .npmrc file?', context.autoApprove)
    if (deleteDecision === 'abort') {
      throw new Error('Aborted before deleting empty .npmrc.')
    }

    if (deleteDecision === 'apply') {
      await unlink(npmrcPath)
      context.changedFiles.add(npmrcPath)
    }

    return
  }

  if (!usesPluginDefaults(context)) {
    return
  }

  const analysis = analyzeNpmrc(raw)
  if (!analysis.onlyRedundantSettings || analysis.redundantLineIndexes.length === 0) {
    return
  }

  const decision = await decideFileStep(
    context,
    'npmrc.remove-redundant',
    'Remove redundant .npmrc settings that are covered by the pnpm defaults plugin?',
    'Aborted before cleaning .npmrc.',
    {
      title: '.npmrc',
      before: raw,
      after: removeNpmrcLines(raw, analysis.redundantLineIndexes)
    }
  )
  if (decision === 'skip') {
    return
  }

  const nextRaw = removeNpmrcLines(raw, analysis.redundantLineIndexes)
  if (decision === 'merge') {
    await applyFileDecision(context, decision, npmrcPath, raw, nextRaw)

    return
  }

  if (nextRaw.trim().length === 0) {
    const deleteDecision = await askEphemeralStep('Delete .npmrc after removing the redundant settings?', context.autoApprove)
    if (deleteDecision === 'abort') {
      throw new Error('Aborted before deleting .npmrc.')
    }

    if (deleteDecision === 'apply') {
      await unlink(npmrcPath)
      context.changedFiles.add(npmrcPath)

      return
    }
  }

  await applyFileDecision(context, decision, npmrcPath, raw, nextRaw)
}

function analyzeNpmrc(raw: string): {
  onlyRedundantSettings: boolean
  redundantLineIndexes: number[]
} {
  const lines = raw.replaceAll('\r\n', '\n').split('\n')
  const redundantLineIndexes: number[] = []
  let foundSettings = false
  let onlyRedundantSettings = true

  for (const [ index, line ] of lines.entries()) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#') || trimmed.startsWith(';')) {
      continue
    }

    foundSettings = true

    const entry = parseNpmrcEntry(trimmed)
    if (!entry) {
      onlyRedundantSettings = false
      continue
    }

    const redundantValue = redundantNpmrcSettings.get(entry.key)
    if (redundantValue === entry.value) {
      redundantLineIndexes.push(index)
    } else {
      onlyRedundantSettings = false
    }
  }

  return {
    onlyRedundantSettings: foundSettings && onlyRedundantSettings,
    redundantLineIndexes
  }
}

function parseNpmrcEntry(line: string): { key: string; value: string } | null {
  const separatorIndex = line.includes('=') ? line.indexOf('=') : line.indexOf(' ')
  if (separatorIndex === -1) {
    return null
  }

  const key = line.slice(0, separatorIndex).trim().toLowerCase()
  const value = line.slice(separatorIndex + 1).trim()

  return key.length > 0 ? { key, value } : null
}

function removeNpmrcLines(raw: string, indexes: number[]): string {
  const newline = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.replaceAll('\r\n', '\n').split('\n')
  const toRemove = new Set(indexes)
  const next = lines.filter((_, index) => !toRemove.has(index)).join('\n').replace(trailingNewlinesPattern, '\n')

  return next.replaceAll('\n', newline)
}
