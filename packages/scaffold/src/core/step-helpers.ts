import type { AppContext } from './types'
import { askStep } from './prompts'


export async function decideFileStep(
  context: AppContext,
  key: string,
  message: string,
  abortMessage: string,
  preview: {
    title: string
    before: string
    after: string
  }
): Promise<'apply' | 'skip' | 'merge'> {
  const decision = await askStep(context, key, message, preview)
  if (decision === 'abort') {
    throw new Error(abortMessage)
  }

  return decision
}

export async function shouldApplyStep(
  context: AppContext,
  key: string,
  message: string,
  abortMessage: string,
  preview?: {
    title: string
    before: string
    after: string
  }
): Promise<boolean> {
  const decision = await askStep(context, key, message, preview)
  if (decision === 'abort') {
    throw new Error(abortMessage)
  }

  if (decision === 'merge') {
    throw new Error(`Manual merge is not supported for "${key}" without a file preview.`)
  }

  return decision === 'apply'
}
