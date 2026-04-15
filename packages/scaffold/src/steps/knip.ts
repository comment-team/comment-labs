import path from 'node:path'
import { readFile } from 'node:fs/promises'

import { applyFileDecision, exists } from '../core/filesystem'
import { askStep } from '../core/prompts'
import { shouldApplyStep } from '../core/step-helpers'
import type { AppContext } from '../core/types'
import { knipTemplate } from '../templates/knip'
import { getInstalledPackageVersion, runPnpmAdd } from './pnpm'


export async function handleKnip(context: AppContext): Promise<void> {
  if (typeof context.packageJson?.devDependencies?.knip !== 'string') {
    if (!(await shouldApplyStep(context, 'knip.install', 'Install knip?', 'Aborted before knip install.'))) {
      return
    }

    runPnpmAdd(context.cwd, [ '-D', 'knip' ])
  }

  const packageVersion = getInstalledPackageVersion(context.cwd, 'knip')

  const knipPath = path.join(context.cwd, 'knip.jsonc')
  const before = (await exists(knipPath)) ? await readFile(knipPath, 'utf8') : ''
  const after = knipTemplate(packageVersion)
  const decision = await askStep(context, 'knip.config', 'Write knip.jsonc?', {
    title: 'knip.jsonc',
    before,
    after
  })
  if (decision === 'abort') {
    throw new Error('Aborted before writing knip.jsonc.')
  }

  await applyFileDecision(context, decision, knipPath, before, after)
}
