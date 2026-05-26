import type { AppContext } from './types'
import { handleCodeowners } from '../steps/codeowners'
import { handleEmptyFolder } from '../steps/empty-folder'
import { handleEditorConfig, handleGitattributes, handleGitignore, handleRenovate } from '../steps/git-files'
import { handleKnip } from '../steps/knip'
import { handleNpmrc } from '../steps/npmrc'
import { handlePackageLint } from '../steps/package-lint'
import { handleWorkspacePackageJsonSchema } from '../steps/package-manifests'
import { handlePackageJson } from '../steps/package-json'
import { handlePackageTypescript } from '../steps/package-typescript'
import { handleChangesets, handlePnpmPlugin } from '../steps/pnpm'
import { handleWorkspace, inferMonorepo } from '../steps/workspace'


type ScaffoldStep = {
  name: string
  run: (context: AppContext) => Promise<void>
}

const scaffoldSteps: ScaffoldStep[] = [
  {
    name: 'preflight',
    run: handleEmptyFolder
  },
  {
    name: 'root package manifest',
    run: handlePackageJson
  },
  {
    name: 'workspace layout',
    run: async context => {
      await handleWorkspace(context, await inferMonorepo(context))
    }
  },
  {
    name: 'repository files',
    run: async context => {
      await handleGitignore(context)
      await handleGitattributes(context)
      await handleEditorConfig(context)
    }
  },
  {
    name: 'github files',
    run: async context => {
      await handleRenovate(context)
      await handleCodeowners(context)
    }
  },
  {
    name: 'pnpm defaults',
    run: async context => {
      await handlePnpmPlugin(context)
      await handleNpmrc(context)
    }
  },
  {
    name: 'release tooling',
    run: handleChangesets
  },
  {
    name: 'root tooling',
    run: handleKnip
  },
  {
    name: 'workspace package manifests',
    run: handleWorkspacePackageJsonSchema
  },
  {
    name: 'workspace typescript',
    run: handlePackageTypescript
  },
  {
    name: 'workspace linting',
    run: handlePackageLint
  }
]

export async function runScaffoldFlow(context: AppContext): Promise<void> {
  for (const step of scaffoldSteps) {
    await step.run(context)
  }
}
