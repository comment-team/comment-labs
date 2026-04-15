import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import path from 'node:path'
import process from 'node:process'

import { watch } from 'chokidar'

import { logInfo } from './log'
import type { AppContext, StepDecision } from './types'


const templateBlockSplitPattern = /\n{2,}/
const conflictMarkerPattern = /^(?:<<<<<<< existing|=======|>>>>>>> scaffold-recommended)$/m
const trailingNewlinesPattern = /\n+$/u

export async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)

    return true
  } catch {
    return false
  }
}

export async function writeTextFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, ensureFinalNewline(content), 'utf8')
}

export async function writeTextFileIfChanged(filePath: string, content: string): Promise<boolean> {
  const existing = (await exists(filePath)) ? await readFile(filePath, 'utf8') : null
  const next = ensureFinalNewline(content)
  if (existing === next) {
    return false
  }

  await writeTextFile(filePath, next)

  return true
}

export async function buildAppendedContent(filePath: string, template: string): Promise<{
  before: string
  after: string
  changed: boolean
}> {
  const existing = (await exists(filePath)) ? await readFile(filePath, 'utf8') : ''
  const newline = existing.includes('\r\n') ? '\r\n' : '\n'
  const normalizedExisting = existing.replaceAll('\r\n', '\n')
  const appended = buildMissingTemplateBlocks(normalizedExisting, template)

  if (appended.length === 0) {
    return {
      before: existing,
      after: existing,
      changed: false
    }
  }

  const suffix = normalizedExisting.length > 0 && !normalizedExisting.endsWith('\n') ? '\n' : ''
  const separator = normalizedExisting.trim().length > 0 ? '\n\n' : ''
  const next = `${normalizedExisting}${suffix}${separator}${appended.join('\n\n')}\n`.replaceAll('\n', newline)

  return {
    before: existing,
    after: next,
    changed: true
  }
}

export async function trackWriteTextFileIfChanged(
  context: AppContext,
  filePath: string,
  content: string
): Promise<void> {
  if (await writeTextFileIfChanged(filePath, content)) {
    context.changedFiles.add(filePath)
  }
}

export async function trackWriteMergeConflictAndWait(
  context: AppContext,
  filePath: string,
  existing: string,
  scaffoldRecommended: string
): Promise<void> {
  if (await writeMergeConflictAndWait(filePath, existing, scaffoldRecommended)) {
    context.changedFiles.add(filePath)
  }
}

export async function applyFileDecision(
  context: AppContext,
  decision: StepDecision,
  filePath: string,
  before: string,
  after: string
): Promise<void> {
  if (decision === 'skip') {
    return
  }

  if (decision === 'merge') {
    await trackWriteMergeConflictAndWait(context, filePath, before, after)

    return
  }

  if (decision === 'apply') {
    await trackWriteTextFileIfChanged(context, filePath, after)

    return
  }

  throw new Error(`Unsupported file decision "${decision}".`)
}

function buildMissingTemplateBlocks(existing: string, template: string): string[] {
  if (existing.trim().length === 0) {
    return [ template.trim() ]
  }

  const currentLines = new Set(existing.split('\n'))
  const blocks = template
    .trim()
    .split(templateBlockSplitPattern)
    .map(block => block.trim())
    .filter(block => block.length > 0)

  const appendedBlocks: string[] = []

  for (const block of blocks) {
    const lines = block.split('\n')
    const contentLines = lines.filter(line => isManagedEntry(line))
    if (contentLines.length === 0) {
      continue
    }

    const missingEntries = contentLines.filter(line => !currentLines.has(line))
    if (missingEntries.length === 0) {
      continue
    }

    const commentLines = lines.filter(line => isCommentLine(line) && !currentLines.has(line))
    const renderedBlock = [ ...commentLines, ...missingEntries ].join('\n').trim()
    if (renderedBlock.length > 0) {
      appendedBlocks.push(renderedBlock)
    }
  }

  return appendedBlocks
}

function isCommentLine(line: string): boolean {
  return line.trimStart().startsWith('#')
}

function isManagedEntry(line: string): boolean {
  const trimmed = line.trim()

  return trimmed.length > 0 && !trimmed.startsWith('#')
}

async function writeMergeConflictAndWait(
  filePath: string,
  existing: string,
  scaffoldRecommended: string
): Promise<boolean> {
  const conflict = buildMergeConflict(existing, scaffoldRecommended)
  const changed = await writeTextFileIfChanged(filePath, conflict)
  await waitForConflictResolution(filePath)

  return changed
}

function buildMergeConflict(existing: string, scaffoldRecommended: string): string {
  const newline = existing.includes('\r\n') ? '\r\n' : scaffoldRecommended.includes('\r\n') ? '\r\n' : '\n'
  const normalizedExisting = trimTrailingNewlines(existing.replaceAll('\r\n', '\n'))
  const normalizedScaffold = trimTrailingNewlines(scaffoldRecommended.replaceAll('\r\n', '\n'))

  return [
    '<<<<<<< existing',
    normalizedExisting,
    '=======',
    normalizedScaffold,
    '>>>>>>> scaffold-recommended',
    ''
  ].join('\n').replaceAll('\n', newline)
}

async function waitForConflictResolution(filePath: string): Promise<void> {
  logInfo(`Waiting for manual merge in ${path.relative(process.cwd(), filePath) || path.basename(filePath)}.`)

  const watcher = watch(filePath, { persistent: true })

  try {
    for (;;) {
      try {
        const content = await readFile(filePath, 'utf8')
        if (!hasConflictMarkers(content)) {
          return
        }
      } catch (error) {
        if (!isErrnoException(error) || error.code !== 'ENOENT') {
          throw error instanceof Error ? error : new Error(String(error))
        }
      }

      await Promise.race([
        once(watcher, 'add'),
        once(watcher, 'change'),
        once(watcher, 'unlink'),
        once(watcher, 'error').then(([ error ]) => {
          throw error instanceof Error ? error : new Error(String(error))
        })
      ])
    }
  } finally {
    await watcher.close()
  }
}

function hasConflictMarkers(content: string): boolean {
  return conflictMarkerPattern.test(content)
}

function trimTrailingNewlines(content: string): string {
  return content.replace(trailingNewlinesPattern, '')
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function ensureFinalNewline(content: string): string {
  if (content.length === 0 || content.endsWith('\n')) {
    return content
  }

  const newline = content.includes('\r\n') ? '\r\n' : '\n'

  return `${content}${newline}`
}
