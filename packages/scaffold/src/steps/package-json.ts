import { getNpmVersion } from 'detect-package-manager'

import { trackWriteMergeConflictAndWait } from '../core/filesystem'
import { askStep } from '../core/prompts'
import type { AppContext, PackageJson } from '../core/types'
import { formatRootPackageJson, inferPackageName, readPackageJson, withJsonSchemaFirst, writePackageJson } from '../manifests/root-package-json'


export async function handlePackageJson(context: AppContext): Promise<void> {
  const desiredName = inferPackageName(context)
  const pnpmVersion = await getNpmVersion('pnpm')
  const desiredPackageManager = `pnpm@${pnpmVersion}`

  if (!context.packageJson) {
    await maybeCreatePackageJson(context, desiredName, desiredPackageManager)

    return
  }

  let nextPackageJson = structuredClone(context.packageJson)
  let changed = false

  if (nextPackageJson.$schema !== 'https://json.schemastore.org/package.json') {
    nextPackageJson = withJsonSchemaFirst(nextPackageJson)
    changed = true
  }

  ({ nextPackageJson, changed } = await maybeUpdatePackageName(context, nextPackageJson, desiredName, changed))
  ;({ nextPackageJson, changed } = await maybeUpdatePackagePrivate(context, nextPackageJson, changed))
  ;({ nextPackageJson, changed } = await maybeUpdatePackageManager(
    context,
    nextPackageJson,
    desiredPackageManager,
    changed
  ))

  if (changed) {
    await writePackageJson(context, nextPackageJson)
  }
}

async function maybeCreatePackageJson(
  context: AppContext,
  desiredName: string,
  desiredPackageManager: string
): Promise<void> {
  const nextPackageJson: PackageJson = {
    $schema: 'https://json.schemastore.org/package.json',
    name: desiredName,
    private: true,
    packageManager: desiredPackageManager
  }
  const decision = await askStep(context, 'package.json.create', `Create package.json with name "${desiredName}", private=true, and packageManager="${desiredPackageManager}"?`, {
    title: 'package.json',
    before: '',
    after: formatRootPackageJson(context, nextPackageJson)
  })
  if (decision === 'abort') {
    throw new Error('Aborted before creating package.json.')
  }

  if (decision !== 'apply') {
    return
  }

  await writePackageJson(context, nextPackageJson)
}

async function maybeUpdatePackageName(
  context: AppContext,
  nextPackageJson: PackageJson,
  desiredName: string,
  changed: boolean
): Promise<{ nextPackageJson: PackageJson; changed: boolean }> {
  if (nextPackageJson.name === desiredName) {
    return { nextPackageJson, changed }
  }

  const candidate = { ...nextPackageJson, name: desiredName }
  const currentName = nextPackageJson.name ?? ''
  const decision = await askStep(context, 'package.json.name', `Update package.json name from "${currentName}" to "${desiredName}"?`, {
    title: 'package.json',
    before: formatRootPackageJson(context, nextPackageJson),
    after: formatRootPackageJson(context, candidate)
  })

  return applyPackageJsonDecision(context, nextPackageJson, candidate, decision, 'Aborted while updating package.json name.', draft => {
    draft.name = desiredName
  }, changed)
}

async function maybeUpdatePackagePrivate(
  context: AppContext,
  nextPackageJson: PackageJson,
  changed: boolean
): Promise<{ nextPackageJson: PackageJson; changed: boolean }> {
  if (nextPackageJson.private === true) {
    return { nextPackageJson, changed }
  }

  const candidate = { ...nextPackageJson, private: true }
  const decision = await askStep(context, 'package.json.private', 'Set package.json private to true?', {
    title: 'package.json',
    before: formatRootPackageJson(context, nextPackageJson),
    after: formatRootPackageJson(context, candidate)
  })

  return applyPackageJsonDecision(context, nextPackageJson, candidate, decision, 'Aborted while updating package.json private.', draft => {
    draft.private = true
  }, changed)
}

async function maybeUpdatePackageManager(
  context: AppContext,
  nextPackageJson: PackageJson,
  desiredPackageManager: string,
  changed: boolean
): Promise<{ nextPackageJson: PackageJson; changed: boolean }> {
  if (nextPackageJson.packageManager === desiredPackageManager) {
    return { nextPackageJson, changed }
  }

  if (typeof nextPackageJson.packageManager === 'string' && nextPackageJson.packageManager.startsWith('pnpm@')) {
    return { nextPackageJson, changed }
  }

  const candidate = { ...nextPackageJson, packageManager: desiredPackageManager }
  const message = typeof nextPackageJson.packageManager === 'string'
    ? `Update package.json packageManager from "${nextPackageJson.packageManager}" to "${desiredPackageManager}"?`
    : `Set package.json packageManager to "${desiredPackageManager}"?`
  const decision = await askStep(context, 'package.json.packageManager', message, {
    title: 'package.json',
    before: formatRootPackageJson(context, nextPackageJson),
    after: formatRootPackageJson(context, candidate)
  })

  return applyPackageJsonDecision(context, nextPackageJson, candidate, decision, 'Aborted while updating package.json packageManager.', draft => {
    draft.packageManager = desiredPackageManager
  }, changed)
}

async function applyPackageJsonDecision(
  context: AppContext,
  current: PackageJson,
  candidate: PackageJson,
  decision: Awaited<ReturnType<typeof askStep>>,
  abortMessage: string,
  apply: (draft: PackageJson) => void,
  changed: boolean
): Promise<{ nextPackageJson: PackageJson; changed: boolean }> {
  if (decision === 'abort') {
    throw new Error(abortMessage)
  }

  if (decision === 'merge') {
    return {
      nextPackageJson: await mergeRootPackageJson(context, current, candidate),
      changed: false
    }
  }

  if (decision === 'apply') {
    const draft = structuredClone(current)
    apply(draft)

    return {
      nextPackageJson: draft,
      changed: true
    }
  }

  return { nextPackageJson: current, changed }
}

async function mergeRootPackageJson(
  context: AppContext,
  current: PackageJson,
  candidate: PackageJson
): Promise<PackageJson> {
  await trackWriteMergeConflictAndWait(
    context,
    context.packageJsonPath,
    formatRootPackageJson(context, current),
    formatRootPackageJson(context, candidate)
  )

  const packageState = await readPackageJson(context.packageJsonPath)
  if (!packageState.json) {
    throw new Error('Resolved package.json is not valid JSON.')
  }

  context.packageJson = packageState.json
  context.packageJsonIndent = packageState.indent
  context.packageJsonNewline = packageState.newline

  return structuredClone(packageState.json)
}
