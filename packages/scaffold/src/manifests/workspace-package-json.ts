import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { exists, writeTextFile } from '../core/filesystem'
import { detectIndent, isPackageJson } from '../core/utils'
import type { PackageJson } from '../core/types'
import type { WorkspacePackage } from '../core/package-step'


export async function discoverWorkspacePackages(cwd: string): Promise<WorkspacePackage[]> {
  const packagesRoot = path.join(cwd, 'packages')
  if (!(await exists(packagesRoot))) {
    return []
  }

  const entries = await readdir(packagesRoot, { withFileTypes: true })
  const results: WorkspacePackage[] = []

  for (const entry of entries
    .filter(candidate => candidate.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const dirPath = path.join(packagesRoot, entry.name)
    const packageJsonPath = path.join(dirPath, 'package.json')
    if (!(await exists(packageJsonPath))) {
      continue
    }

    const { json, indent, newline } = await readAnyPackageJson(packageJsonPath)
    if (!json) {
      continue
    }

    results.push({
      dirName: entry.name,
      dirPath,
      packageJsonPath,
      packageJson: json,
      indent,
      newline
    })
  }

  return results
}

export async function writeWorkspacePackageJson(pkg: WorkspacePackage, packageJson: PackageJson): Promise<boolean> {
  const body = formatWorkspacePackageJson(pkg, packageJson)
  const existing = await readFile(pkg.packageJsonPath, 'utf8')
  if (existing === body) {
    return false
  }

  await writeTextFile(pkg.packageJsonPath, body)
  pkg.packageJson = withSchemaFirst(packageJson)

  return true
}

export async function refreshWorkspacePackage(pkg: WorkspacePackage): Promise<void> {
  const { json, indent, newline } = await readAnyPackageJson(pkg.packageJsonPath)
  if (!json) {
    throw new Error(`Invalid package.json in ${pkg.packageJsonPath}.`)
  }

  pkg.packageJson = json
  pkg.indent = indent
  pkg.newline = newline
}

export function formatWorkspacePackageJson(pkg: WorkspacePackage, packageJson: PackageJson): string {
  return `${JSON.stringify(withSchemaFirst(packageJson), null, pkg.indent)}${pkg.newline}`
}

async function readAnyPackageJson(packageJsonPath: string): Promise<{
  json: PackageJson | null
  indent: string
  newline: string
}> {
  const raw = await readFile(packageJsonPath, 'utf8')

  return {
    json: parsePackageJson(raw),
    indent: detectIndent(raw),
    newline: raw.includes('\r\n') ? '\r\n' : '\n'
  }
}

function withSchemaFirst(packageJson: PackageJson): PackageJson {
  const { $schema: _, ...rest } = packageJson

  return {
    $schema: 'https://json.schemastore.org/package.json',
    ...rest
  }
}

function parsePackageJson(raw: string): PackageJson | null {
  const parsed: unknown = JSON.parse(raw)

  return isPackageJson(parsed) ? parsed : null
}
