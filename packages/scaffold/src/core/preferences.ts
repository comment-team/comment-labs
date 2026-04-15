import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { exists, writeTextFileIfChanged } from './filesystem'
import type { AppContext, GitContext, JsonValue, StoredPreferences } from './types'


const githubPreferencesPath = [ '.github', 'comment-labs-scaffold.json' ]
const configPreferencesPath = [ '.config', 'comment-labs-scaffold.json' ]

export async function readPreferences(cwd: string, git: GitContext): Promise<{
  path: string
  preferences: StoredPreferences
}> {
  const githubPath = path.join(cwd, ...githubPreferencesPath)
  const configPath = path.join(cwd, ...configPreferencesPath)
  const preferredPath = git.githubRepo !== null ? githubPath : configPath

  for (const candidatePath of [ githubPath, configPath ]) {
    if (!(await exists(candidatePath))) {
      continue
    }

    try {
      const raw = await readFile(candidatePath, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (isStoredPreferences(parsed)) {
        return {
          path: preferredPath,
          preferences: structuredClone(parsed)
        }
      }
    } catch {
      // Ignore invalid preference files and fall back to defaults.
    }
  }

  return {
    path: preferredPath,
    preferences: {}
  }
}

export async function persistPreferences(context: AppContext): Promise<void> {
  const body = `${JSON.stringify(context.preferences, null, 2)}\n`
  if (await writeTextFileIfChanged(context.preferencesPath, body)) {
    context.changedFiles.add(context.preferencesPath)
  }
}

export function getPreference(preferences: StoredPreferences, key: string): JsonValue | undefined {
  let current: JsonValue | undefined = preferences

  for (const part of key.split('.')) {
    if (!isJsonObject(current)) {
      return undefined
    }

    current = current[part]
  }

  return current
}

export function setPreference(preferences: StoredPreferences, key: string, value: JsonValue): StoredPreferences {
  const next = structuredClone(preferences)
  const parts = key.split('.')
  const lastPart = parts.at(-1)
  if (lastPart === undefined) {
    return next
  }

  let current: StoredPreferences = next

  for (const part of parts.slice(0, -1)) {
    const existing = current[part]
    if (!isJsonObject(existing)) {
      current[part] = {}
    }

    const nextCurrent = current[part]
    if (!isJsonObject(nextCurrent)) {
      return next
    }

    current = nextCurrent
  }

  current[lastPart] = value

  return next
}

function isJsonObject(value: JsonValue | undefined): value is StoredPreferences {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
}

function isStoredPreferences(value: unknown): value is StoredPreferences {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  return Object.values(value).every(entry => isJsonValue(entry))
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) {
    return true
  }

  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return true
  }

  if (Array.isArray(value)) {
    return value.every(entry => isJsonValue(entry))
  }

  if (typeof value === 'object') {
    return Object.values(value).every(entry => isJsonValue(entry))
  }

  return false
}
