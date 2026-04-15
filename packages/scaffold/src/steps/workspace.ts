import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { parse } from 'yaml'

import { applyFileDecision, exists } from '../core/filesystem'
import { askBoolean, askStep, runMultiselectPrompt } from '../core/prompts'
import { getPreference, persistPreferences, setPreference } from '../core/preferences'
import { decideFileStep } from '../core/step-helpers'
import type { AppContext, JsonValue, WorkspacePackageSelection } from '../core/types'


const workspaceSchema = 'https://www.schemastore.org/pnpm-workspace.json'
const workspaceSchemaComment = `# yaml-language-server: $schema=${workspaceSchema}`
const trailingWorkspaceNewlinesPattern = /\n+$/

export async function inferMonorepo(context: AppContext): Promise<boolean> {
  const packagesDir = path.join(context.cwd, 'packages')
  if (await exists(packagesDir)) {
    return true
  }

  const decision = await askStep(context, 'workspace.monorepo', 'No packages/ directory found. Should this repository use a pnpm monorepo workspace?')
  if (decision === 'abort') {
    throw new Error('Aborted while deciding workspace mode.')
  }

  return decision === 'apply'
}

export async function handleWorkspace(context: AppContext, monorepo: boolean): Promise<void> {
  const workspacePath = path.join(context.cwd, 'pnpm-workspace.yaml')
  const packagesDir = path.join(context.cwd, 'packages')
  let packagesGlobs: string[] = []

  if (monorepo) {
    packagesGlobs = [ 'packages/*' ]
  }

  if (await exists(packagesDir)) {
    const packageSelections = await selectWorkspacePackages(context, packagesDir, workspacePath)
    if (packageSelections.length > 0) {
      const all = packageSelections.every(entry => entry.selected)
      packagesGlobs = [ 'packages/*' ]
      if (!all) {
        packagesGlobs.push(...packageSelections.filter(entry => !entry.selected).map(entry => `!packages/${entry.name}`))
      }
    } else if (monorepo) {
      packagesGlobs = [ 'packages/*' ]
    }
  }

  const existingWorkspace = (await exists(workspacePath)) ? await readFile(workspacePath, 'utf8') : ''
  const hasSchema = workspaceHasSchemaComment(existingWorkspace)
  const nextWorkspaceWithPackages = await buildWorkspaceFile(workspacePath, packagesGlobs, hasSchema)
  if (nextWorkspaceWithPackages !== existingWorkspace) {
    const decision = await decideFileStep(
      context,
      'workspace.file',
      `Write pnpm-workspace.yaml${packagesGlobs.length > 0 ? ` with ${packagesGlobs.join(', ')}` : ''}?`,
      'Aborted before writing pnpm-workspace.yaml.',
      {
        title: 'pnpm-workspace.yaml',
        before: existingWorkspace,
        after: nextWorkspaceWithPackages
      }
    )
    await applyFileDecision(context, decision, workspacePath, existingWorkspace, nextWorkspaceWithPackages)
  }

  const workspaceAfterPackages = (await exists(workspacePath)) ? await readFile(workspacePath, 'utf8') : ''
  const nextWorkspaceWithSchema = await buildWorkspaceFile(workspacePath, packagesGlobs, true)
  if (nextWorkspaceWithSchema === workspaceAfterPackages) {
    return
  }

  const decision = await askStep(
    context,
    'workspace.schema',
    'Add the pnpm-workspace.yaml schema comment?',
    {
      title: 'pnpm-workspace.yaml',
      before: workspaceAfterPackages,
      after: nextWorkspaceWithSchema
    }
  )
  if (decision === 'abort') {
    throw new Error('Aborted before writing pnpm-workspace.yaml schema.')
  }

  await applyFileDecision(context, decision, workspacePath, workspaceAfterPackages, nextWorkspaceWithSchema)
}

async function selectWorkspacePackages(
  context: AppContext,
  packagesDir: string,
  workspacePath: string
): Promise<WorkspacePackageSelection[]> {
  const packageEntries = await readdir(packagesDir, { withFileTypes: true })
  const dirs = packageEntries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right))

  if (dirs.length === 0) {
    return []
  }

  const storedSelectAll = getPreference(context.preferences, 'workspace.packages.selectAll') === true
  const storedSelection = getPreference(context.preferences, 'workspace.packages.selected')
  const defaultSelection = new Set(Array.isArray(storedSelection) ? storedSelection.filter((value): value is string => typeof value === 'string') : dirs)
  const selectAllByDefault = storedSelectAll || defaultSelection.size === dirs.length
  const existingWorkspaceSelectsAll = await workspaceSelectsAllPackages(workspacePath)

  if (context.autoApprove) {
    return dirs.map(name => ({ name, selected: selectAllByDefault || defaultSelection.has(name) }))
  }

  if (existingWorkspaceSelectsAll) {
    context.preferences = setPreference(context.preferences, 'workspace.packages.selectAll', true)
    context.preferences = setPreference(context.preferences, 'workspace.packages.selected', [] as JsonValue)
    await persistPreferences(context)

    return dirs.map(name => ({ name, selected: true }))
  }

  const allDecision = await askBoolean(
    context,
    'workspace.packages.selectAll',
    'Include all workspace package folders?'
  )
  if (allDecision === 'abort') {
    throw new Error('Aborted while selecting workspace packages.')
  }

  if (allDecision) {
    context.preferences = setPreference(context.preferences, 'workspace.packages.selectAll', true)
    context.preferences = setPreference(context.preferences, 'workspace.packages.selected', [] as JsonValue)
    await persistPreferences(context)

    return dirs.map(name => ({ name, selected: true }))
  }

  const { values } = await runMultiselectPrompt({
    type: 'multiselect',
    name: 'values',
    message: 'Select workspace package folders',
    choices: dirs.map(dir => ({
      title: dir,
      value: dir,
      selected: selectAllByDefault || defaultSelection.has(dir)
    })),
    instructions: false,
    min: 0
  })

  const selectedValues = new Set<string>(values)
  const selectedDirs = dirs.filter(dir => selectedValues.has(dir))
  context.preferences = setPreference(context.preferences, 'workspace.packages.selectAll', false)
  context.preferences = setPreference(context.preferences, 'workspace.packages.selected', selectedDirs as JsonValue)
  await persistPreferences(context)

  return dirs.map(name => ({
    name,
    selected: selectedValues.has(name)
  }))
}

async function buildWorkspaceFile(
  workspacePath: string,
  packagesGlobs: string[],
  includeSchema: boolean
): Promise<string> {
  const existing = (await exists(workspacePath)) ? await readFile(workspacePath, 'utf8') : ''
  const newline = existing.includes('\r\n') ? '\r\n' : '\n'
  const lines = existing.length > 0 ? existing.replaceAll('\r\n', '\n').split('\n') : []

  const nextLines = replaceWorkspacePackages(lines, packagesGlobs)
  const withSchema = applyWorkspaceSchema(nextLines, includeSchema)

  return withSchema.join('\n').replace(trailingWorkspaceNewlinesPattern, '\n').replaceAll('\n', newline)
}

function replaceWorkspacePackages(lines: string[], packagesGlobs: string[]): string[] {
  const packageBlock = packagesGlobs.length === 0
    ? [ 'packages: []' ]
    : [ 'packages:', ...packagesGlobs.map(entry => `  - '${entry}'`) ]

  const startIndex = lines.findIndex(line => line.startsWith('packages:'))
  if (startIndex === -1) {
    const insertIndex = lines[0] === workspaceSchemaComment ? 1 : 0

    return [
      ...lines.slice(0, insertIndex),
      ...packageBlock,
      ...(lines.length > 0 ? [ '' ] : []),
      ...lines.slice(insertIndex)
    ].filter((line, index, list) => !(line === '' && list[index - 1] === ''))
  }

  let endIndex = startIndex + 1

  while (endIndex < lines.length) {
    const line = lines[endIndex] ?? ''
    if (line.length > 0 && !line.startsWith(' ') && !line.startsWith('\t') && !line.startsWith('#')) {
      break
    }

    endIndex += 1
  }

  const currentPackageBlock = lines.slice(startIndex, endIndex)
  const currentPackageEntries = currentPackageBlock.filter((line, index) => {
    if (index === 0) {
      return true
    }

    const trimmed = line.trim()

    return trimmed.length > 0 && !trimmed.startsWith('#')
  })

  if (arraysEqual(currentPackageEntries, packageBlock)) {
    return lines
  }

  return [
    ...lines.slice(0, startIndex),
    ...packageBlock,
    ...lines.slice(endIndex)
  ]
}

function applyWorkspaceSchema(lines: string[], includeSchema: boolean): string[] {
  const withoutSchema = lines
    .filter((line, index) => !(index === 0 && line === workspaceSchemaComment))
    .filter((line, index, list) => !(index === 0 && line === '' && list.length > 1))
  if (!includeSchema) {
    return withoutSchema
  }

  return withoutSchema.length > 0
    ? [ workspaceSchemaComment, '', ...withoutSchema ]
    : [ workspaceSchemaComment ]
}

async function workspaceSelectsAllPackages(workspacePath: string): Promise<boolean> {
  if (!(await exists(workspacePath))) {
    return false
  }

  try {
    const raw = await readFile(workspacePath, 'utf8')
    const parsed: unknown = parse(raw)
    if (!isWorkspaceConfig(parsed) || !Array.isArray(parsed.packages)) {
      return false
    }

    return parsed.packages.length === 1 && parsed.packages[0] === 'packages/*'
  } catch {
    return false
  }
}

function workspaceHasSchemaComment(raw: string): boolean {
  const firstLine = raw.replaceAll('\r\n', '\n').split('\n')[0]

  return firstLine === workspaceSchemaComment
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function isWorkspaceConfig(value: unknown): value is { packages?: unknown } {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
