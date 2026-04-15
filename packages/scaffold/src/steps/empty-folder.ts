import { readdir } from 'node:fs/promises'

import { detect } from 'detect-package-manager'

import { logWarn } from '../core/log'
import { askStep } from '../core/prompts'
import type { AppContext } from '../core/types'


export async function handleEmptyFolder(context: AppContext): Promise<void> {
  const entries = await readdir(context.cwd, { withFileTypes: true })
  const visibleEntries = entries.filter(entry => entry.name !== '.git')
  if (visibleEntries.length > 0) {
    return
  }

  if (context.git.root === null) {
    const decision = await askStep(context, 'empty-folder.continue-without-git', 'Current folder is empty and not inside a git repository. Continue anyway?')
    if (decision === 'abort') {
      throw new Error('Aborted before scaffolding an empty non-git directory.')
    }

    if (decision === 'skip') {
      throw new Error('Scaffolding skipped because the current directory is empty and not in git.')
    }

    logWarn('Proceeding without git metadata.')

    return
  }

  const pm = await detect({ cwd: context.cwd })
  if (pm === 'npm' || pm === 'yarn' || pm === 'bun') {
    throw new Error(`Found ${pm} lockfile in an otherwise empty repository. Remove it before running scaffold.`)
  }
}
