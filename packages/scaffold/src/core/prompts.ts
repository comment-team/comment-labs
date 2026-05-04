import process from 'node:process'
import prompts from 'prompts'
import { renderDiffPreview } from './diff'
import { getPreference, persistPreferences, setPreference } from './preferences'
import type { AppContext, PromptChoice, StepDecision } from './types'


export class PromptCancelledError extends Error {
  constructor() {
    super('Prompt cancelled.')
    this.name = 'PromptCancelledError'
  }
}

export const cancelled = new PromptCancelledError()

type StepPreview = {
  title: string
  before: string
  after: string
}

type PromptQuestion
  = | {
    type: 'select'
    name: string
    message: string
    choices: PromptChoice[]
    initial?: number
  }
  | {
    type: 'text'
    name: 'value'
    message: string
    initial?: string
    validate?: (input: string) => boolean | string
  }
  | {
    type: 'multiselect'
    name: 'values'
    message: string
    choices: PromptChoice[]
    instructions?: boolean
    min?: number
  }

function isStepDecision(value: unknown): value is StepDecision {
  return value === 'apply' || value === 'skip' || value === 'merge' || value === 'abort'
}

function isPromptChoiceValue<T extends string>(
  value: unknown,
  choices: Array<PromptChoice & { value: T }>
): value is T {
  return typeof value === 'string' && choices.some(choice => choice.value === value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string')
}

export async function askStep(
  context: AppContext,
  key: string,
  message: string,
  preview?: StepPreview
): Promise<StepDecision> {
  const stored = getPreference(context.preferences, key)
  if (stored === true) {
    return 'apply'
  }

  if (stored === false) {
    return 'skip'
  }

  if (stored === 'merge') {
    return 'merge'
  }

  if (context.autoApprove) {
    throw new Error(`Missing saved scaffold preference for "${key}" while running with --verify.`)
  }

  if (preview) {
    process.stdout.write(`\n${renderDiffPreview(preview.title, preview.before, preview.after)}\n`)
  }

  const choices = [
    { title: 'Apply', value: 'apply' },
    { title: 'Skip', value: 'skip' },
    ...(preview && preview.before.length > 0 ? [{ title: 'Merge manually', value: 'merge' }] : []),
    { title: 'Abort', value: 'abort' }
  ]

  const { decision } = await runPrompt({
    type: 'select',
    name: 'decision',
    message,
    choices,
    initial: 0
  })

  if (decision === 'apply' || decision === 'skip' || decision === 'merge') {
    context.preferences = setPreference(
      context.preferences,
      key,
      decision === 'apply' ? true : decision === 'skip' ? false : 'merge'
    )
    await persistPreferences(context)
  }

  if (!isStepDecision(decision)) {
    throw new Error('Prompt returned an invalid step decision.')
  }

  return decision
}

export async function askSelect<T extends string>(
  context: AppContext,
  key: string,
  message: string,
  choices: Array<PromptChoice & { value: T }>,
  initialValue: T
): Promise<T> {
  const stored = getPreference(context.preferences, key)
  if (isPromptChoiceValue(stored, choices)) {
    return stored
  }

  if (context.autoApprove) {
    throw new Error(`Missing saved scaffold preference for "${key}" while running with --verify.`)
  }

  const initial = Math.max(
    choices.findIndex(choice => choice.value === initialValue),
    0
  )

  const { value } = await runPrompt({
    type: 'select',
    name: 'value',
    message,
    choices,
    initial
  })

  if (!isPromptChoiceValue(value, choices)) {
    throw new Error('Prompt returned an invalid choice.')
  }

  context.preferences = setPreference(context.preferences, key, value)
  await persistPreferences(context)

  return value
}

export async function askBoolean(context: AppContext, key: string, message: string): Promise<boolean | 'abort'> {
  const stored = getPreference(context.preferences, key)
  if (stored === true || stored === false) {
    return stored
  }

  if (context.autoApprove) {
    throw new Error(`Missing saved scaffold preference for "${key}" while running with --verify.`)
  }

  const { decision } = await runPrompt({
    type: 'select',
    name: 'decision',
    message,
    choices: [
      { title: 'Yes', value: 'yes' },
      { title: 'No', value: 'no' },
      { title: 'Abort', value: 'abort' }
    ],
    initial: 0
  })

  if (decision === 'abort') {
    return 'abort'
  }

  const value = decision === 'yes'
  context.preferences = setPreference(context.preferences, key, value)
  await persistPreferences(context)

  return value
}

export async function askText(
  context: AppContext,
  key: string,
  message: string,
  initialValue: string
): Promise<string> {
  const stored = getPreference(context.preferences, key)
  if (typeof stored === 'string' && stored.trim().length > 0) {
    return stored
  }

  if (context.autoApprove) {
    throw new Error(`Missing saved scaffold preference for "${key}" while running with --verify.`)
  }

  const { value } = await runPrompt({
    type: 'text',
    name: 'value',
    message,
    initial: typeof stored === 'string' ? stored : initialValue,
    validate: input => (typeof input === 'string' && input.trim().length > 0 ? true : 'Value is required')
  })

  if (typeof value !== 'string') {
    throw new TypeError('Prompt returned a non-string value.')
  }

  const text = value.trim()
  context.preferences = setPreference(context.preferences, key, text)
  await persistPreferences(context)

  return text
}

export async function askEphemeralStep(message: string, autoApprove = false): Promise<StepDecision> {
  if (autoApprove) {
    throw new Error(`Missing saved scaffold preference for ephemeral prompt "${message}" while running with --verify.`)
  }

  const { decision } = await runPrompt({
    type: 'select',
    name: 'decision',
    message,
    choices: [
      { title: 'Apply', value: 'apply' },
      { title: 'Skip', value: 'skip' },
      { title: 'Abort', value: 'abort' }
    ],
    initial: 0
  })

  if (!isStepDecision(decision)) {
    throw new Error('Prompt returned an invalid step decision.')
  }

  return decision
}

export async function runPrompt(question: PromptQuestion): Promise<Record<string, unknown>> {
  return await prompts(question, {
    onCancel: () => {
      throw cancelled
    }
  })
}

export async function runSelectPrompt<Value extends string>(
  question: {
    type: 'select'
    name: 'decision'
    message: string
    choices: Array<PromptChoice & { value: Value }>
    initial?: number
  }
): Promise<{ decision: Value }>
export async function runSelectPrompt<Value extends string>(
  question: {
    type: 'select'
    name: 'value'
    message: string
    choices: Array<PromptChoice & { value: Value }>
    initial?: number
  }
): Promise<{ value: Value }>
export async function runSelectPrompt<Name extends 'decision' | 'value', Value extends string>(
  question: {
    type: 'select'
    name: Name
    message: string
    choices: Array<PromptChoice & { value: Value }>
    initial?: number
  }
): Promise<{ decision: Value } | { value: Value }> {
  const result = await runPrompt(question)
  const value = result[question.name]
  if (!isPromptChoiceValue(value, question.choices)) {
    throw new Error(`Prompt returned an invalid selection for "${question.name}".`)
  }

  if (question.name === 'decision') {
    return { decision: value }
  }

  return { value }
}

export async function runTextPrompt(
  question: Extract<PromptQuestion, { type: 'text' }>
): Promise<{ value: string }> {
  const result = await runPrompt(question)
  const value = result.value
  if (typeof value !== 'string') {
    throw new TypeError('Prompt returned a non-string text value.')
  }

  return { value }
}

export async function runMultiselectPrompt(
  question: Extract<PromptQuestion, { type: 'multiselect' }>
): Promise<{ values: string[] }> {
  const result = await runPrompt(question)
  const values = result.values
  if (!isStringArray(values)) {
    throw new Error('Prompt returned invalid multiselect values.')
  }

  return { values }
}
