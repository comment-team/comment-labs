import { decideFileStep } from '../core/step-helpers'
import { applyFileDecision } from '../core/filesystem'
import type { AppContext } from '../core/types'
import { discoverWorkspacePackages, formatWorkspacePackageJson, refreshWorkspacePackage } from '../manifests/workspace-package-json'


export async function handleWorkspacePackageJsonSchema(context: AppContext): Promise<void> {
  const packages = await discoverWorkspacePackages(context)

  for (const pkg of packages) {
    const before = `${JSON.stringify(pkg.packageJson, null, pkg.indent)}${pkg.newline}`
    const after = formatWorkspacePackageJson(pkg, pkg.packageJson)
    if (before === after) {
      continue
    }

    const decision = await decideFileStep(
      context,
      `packages.${pkg.dirName}.packageJson.schema`,
      `Add $schema to ${pkg.dirName}/package.json?`,
      `Aborted while updating package.json schema for ${pkg.dirName}.`,
      {
        title: `${pkg.dirName}/package.json`,
        before,
        after
      }
    )
    await applyFileDecision(context, decision, pkg.packageJsonPath, before, after)
    if (decision !== 'skip') {
      await refreshWorkspacePackage(pkg)
    }
  }
}
