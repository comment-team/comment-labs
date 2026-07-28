import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { applyFileDecision, buildAppendedContent, exists } from '../core/filesystem'
import { decideFileStep } from '../core/step-helpers'
import type { AppContext } from '../core/types'
import { editorconfigTemplate } from '../templates/editorconfig'
import { gitattributesTemplate } from '../templates/gitattributes'
import { gitignoreTemplate } from '../templates/gitignore'
import { renovateTemplate } from '../templates/renovate'


const commentTeamPresetPattern = /(^|>)comment-team\//

export async function handleRenovate(context: AppContext): Promise<void> {
  if (context.git.githubRepo === null) {
    return
  }

  const renovatePath = path.join(context.cwd, '.github', 'renovate.json')
  const before = (await exists(renovatePath)) ? await readFile(renovatePath, 'utf8') : ''
  if (hasCommentTeamRenovatePreset(before)) {
    return
  }

  const after = renovateTemplate()
  const decision = await decideFileStep(context, 'renovate', 'Write .github/renovate.json?', 'Aborted before renovate config.', {
    title: '.github/renovate.json',
    before,
    after
  })
  await applyFileDecision(context, decision, renovatePath, before, after)
}

function hasCommentTeamRenovatePreset(content: string): boolean {
  try {
    const parsed: unknown = JSON.parse(content)
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { extends?: unknown }).extends)) {
      return false
    }

    return ((parsed as { extends: unknown[] }).extends).some(entry => typeof entry === 'string' && commentTeamPresetPattern.test(entry))
  } catch {
    return false
  }
}

export async function handleGitignore(context: AppContext): Promise<void> {
  if (context.git.root === null) {
    return
  }

  const filePath = path.join(context.cwd, '.gitignore')
  const preview = await buildAppendedContent(filePath, gitignoreTemplate())
  if (!preview.changed) {
    return
  }

  const decision = await decideFileStep(context, 'gitignore', 'Write or append recommended entries to .gitignore?', 'Aborted before .gitignore updates.', {
    title: '.gitignore',
    before: preview.before,
    after: preview.after
  })
  await applyFileDecision(context, decision, filePath, preview.before, preview.after)
}

export async function handleGitattributes(context: AppContext): Promise<void> {
  if (context.git.root === null) {
    return
  }

  const filePath = path.join(context.cwd, '.gitattributes')
  const preview = await buildAppendedContent(filePath, gitattributesTemplate())
  if (!preview.changed) {
    return
  }

  const decision = await decideFileStep(context, 'gitattributes', 'Write or append recommended entries to .gitattributes?', 'Aborted before .gitattributes updates.', {
    title: '.gitattributes',
    before: preview.before,
    after: preview.after
  })
  await applyFileDecision(context, decision, filePath, preview.before, preview.after)
}

export async function handleEditorConfig(context: AppContext): Promise<void> {
  const filePath = path.join(context.cwd, '.editorconfig')
  const preview = await buildAppendedContent(filePath, editorconfigTemplate())
  if (!preview.changed) {
    return
  }

  const decision = await decideFileStep(context, 'editorconfig', 'Write or append recommended entries to .editorconfig?', 'Aborted before .editorconfig updates.', {
    title: '.editorconfig',
    before: preview.before,
    after: preview.after
  })
  await applyFileDecision(context, decision, filePath, preview.before, preview.after)
}
