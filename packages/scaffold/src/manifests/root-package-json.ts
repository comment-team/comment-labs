import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { writeTextFileIfChanged } from '../core/filesystem'
import { detectIndent, isPackageJson } from '../core/utils'
import type { AppContext, PackageJson } from '../core/types'


const packageJsonSchema = 'https://json.schemastore.org/package.json'

export function inferPackageName(context: AppContext): string {
  return context.git.repositoryName ?? path.basename(context.cwd)
}

export async function readPackageJson(packageJsonPath: string): Promise<{
  json: PackageJson | null
  indent: string
  newline: string
}> {
  try {
    const raw = await readFile(packageJsonPath, 'utf8')

    return {
      json: parsePackageJson(raw),
      indent: detectIndent(raw),
      newline: raw.includes('\r\n') ? '\r\n' : '\n'
    }
  } catch {
    return {
      json: null,
      indent: '  ',
      newline: '\n'
    }
  }
}

export async function writePackageJson(context: AppContext, packageJson: PackageJson): Promise<void> {
  const normalized = withJsonSchemaFirst(packageJson)
  const body = formatRootPackageJson(context, normalized)
  const changed = await writeTextFileIfChanged(context.packageJsonPath, body)
  context.packageJson = normalized
  if (changed) {
    context.changedFiles.add(context.packageJsonPath)
  }
}

export async function updateRootPackageJson(
  context: AppContext,
  updater: (packageJson: PackageJson) => PackageJson
): Promise<void> {
  if (!context.packageJson) {
    throw new Error('package.json is required before applying this step.')
  }

  await writePackageJson(context, updater(structuredClone(context.packageJson)))
}

export function withJsonSchemaFirst(packageJson: PackageJson): PackageJson {
  const { $schema: _, ...rest } = packageJson

  return {
    $schema: packageJsonSchema,
    ...rest
  }
}

export function formatRootPackageJson(context: AppContext, packageJson: PackageJson): string {
  return `${JSON.stringify(withJsonSchemaFirst(packageJson), null, context.packageJsonIndent)}${context.packageJsonNewline}`
}

function parsePackageJson(raw: string): PackageJson | null {
  const parsed: unknown = JSON.parse(raw)

  return isPackageJson(parsed) ? parsed : null
}
