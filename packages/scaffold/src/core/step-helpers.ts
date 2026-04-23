import { createHash } from 'node:crypto'
import process from 'node:process'

import { renderDiffPreview } from './diff'
import { trackWriteMergeConflictAndWait, trackWriteTextFileIfChanged } from './filesystem'
import { getPreference, persistPreferences, setPreference } from './preferences'
import type { AppContext } from './types'
import { runSelectPrompt, askStep } from './prompts'


export async function decideFileStep(
  context: AppContext,
  key: string,
  message: string,
  abortMessage: string,
  preview: {
    title: string
    before: string
    after: string
  }
): Promise<'apply' | 'skip' | 'merge'> {
  const decision = await askStep(context, key, message, preview)
  if (decision === 'abort') {
    throw new Error(abortMessage)
  }

  return decision
}

export async function shouldApplyStep(
  context: AppContext,
  key: string,
  message: string,
  abortMessage: string,
  preview?: {
    title: string
    before: string
    after: string
  }
): Promise<boolean> {
  const decision = await askStep(context, key, message, preview)
  if (decision === 'abort') {
    throw new Error(abortMessage)
  }

  if (decision === 'merge') {
    throw new Error(`Manual merge is not supported for "${key}" without a file preview.`)
  }

  return decision === 'apply'
}

export async function decideProtectedFileStep(
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
): Promise<'apply' | 'skip' | 'merge'> {
  const stored = getPreference(context.preferences, key)
  const fingerprintKey = `${key}RecommendedFingerprint`
  const recommendedFingerprint = fingerprintContent(preview.after)
  const storedFingerprint = getPreference(context.preferences, fingerprintKey)
  const recommendationChanged = storedFingerprint !== recommendedFingerprint

  if (stored === false) {
    return 'skip'
  }

  if (allowApply) {
    const decision = await decideFileStep(context, key, message, abortMessage, preview)
    await persistProtectedFileFingerprint(context, fingerprintKey, decision, recommendedFingerprint)

    return decision
  }

  if (stored === 'merge' && !recommendationChanged) {
    return 'skip'
  }

  if (context.autoApprove) {
    if (stored === 'merge' && recommendationChanged) {
      throw new Error(`Saved manual-merge preference for "${key}" is stale because the scaffold recommendation changed.`)
    }

    throw new Error(`Missing saved scaffold preference for "${key}" while running with --verify.`)
  }

  process.stdout.write(`\n${renderDiffPreview(preview.title, preview.before, preview.after)}\n`)

  const { decision } = await runSelectPrompt({
    type: 'select',
    name: 'decision',
    message: `${message} Existing file differs, so choose whether to overwrite it or merge manually.`,
    choices: [
      { title: 'Overwrite', value: 'apply' },
      { title: 'Merge manually', value: 'merge' },
      { title: 'Skip', value: 'skip' },
      { title: 'Abort', value: 'abort' }
    ],
    initial: 0
  })

  if (decision === 'abort') {
    throw new Error(abortMessage)
  }

  context.preferences = setPreference(
    context.preferences,
    key,
    decision === 'apply' ? true : decision === 'skip' ? false : 'merge'
  )
  if (decision === 'apply' || decision === 'merge') {
    context.preferences = setPreference(context.preferences, fingerprintKey, recommendedFingerprint)
  }

  await persistPreferences(context)

  return decision
}

export async function applyProtectedFileStep(
  context: AppContext,
  key: string,
  filePath: string,
  before: string,
  after: string,
  decision: 'apply' | 'skip' | 'merge'
): Promise<void> {
  if (decision === 'skip') {
    return
  }

  const fingerprintKey = `${key}RecommendedFingerprint`
  const recommendedFingerprint = fingerprintContent(after)

  if (decision === 'apply') {
    await trackWriteTextFileIfChanged(context, filePath, after)
    context.preferences = setPreference(context.preferences, fingerprintKey, recommendedFingerprint)
    await persistPreferences(context)

    return
  }

  const result = await trackWriteMergeConflictAndWait(context, filePath, before, after)
  if (normalizeContent(result.resolved) === normalizeContent(after)) {
    context.preferences = setPreference(context.preferences, key, true)
    context.preferences = setPreference(context.preferences, fingerprintKey, recommendedFingerprint)
    await persistPreferences(context)
  }
}

function fingerprintContent(content: string): string {
  return createHash('sha256').update(normalizeContent(content)).digest('hex')
}

function normalizeContent(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`
}

async function persistProtectedFileFingerprint(
  context: AppContext,
  fingerprintKey: string,
  decision: 'apply' | 'skip' | 'merge',
  fingerprint: string
): Promise<void> {
  if (decision === 'skip') {
    return
  }

  context.preferences = setPreference(context.preferences, fingerprintKey, fingerprint)
  await persistPreferences(context)
}
