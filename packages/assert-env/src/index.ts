import process from 'node:process'

export type EnvType = 'string' | 'number' | 'boolean'

export type EnvSchema = Record<string, EnvType>

type TypeMap = {
  string: string
  number: number
  boolean: boolean
}

type InferEnvSchema<T extends EnvSchema> = {
  [K in keyof T]: TypeMap[T[K]]
}

type EnvDefaults<O extends EnvSchema> = Partial<InferEnvSchema<O>>

type OptionalResult<O extends EnvSchema, D extends EnvDefaults<O> = {}> = {
  [K in keyof O as K extends keyof D ? never : K]?: TypeMap[O[K]] | undefined
} & {
  [K in keyof O as K extends keyof D ? K : never]: TypeMap[O[K]]
}

export interface AssertEnvOptions<O extends EnvSchema, D extends EnvDefaults<O> = {}> {
  optional?: O
  defaults?: D
  processEnv?: boolean
}

interface ValidationError {
  name: string
  message: string
}

function validateString(raw: string): string {
  if (raw.trim() === '') {
    throw new Error('expected non-empty string, got empty string')
  }

  return raw
}

function validateNumber(raw: string): number {
  const trimmed = raw.trim()
  const parsed = Number(trimmed)

  if (Number.isNaN(parsed) || trimmed === '') {
    throw new Error(`expected number, got "${raw}"`)
  }

  return parsed
}

function validateBoolean(raw: string): boolean {
  const normalized = raw.trim().toLowerCase()

  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false
  }

  throw new Error(`expected boolean, got "${raw}"`)
}

function assertSingleEnv(
  name: string,
  raw: string | undefined,
  type: EnvType
): string | number | boolean {
  if (raw === undefined) {
    throw new Error('required but not set')
  }

  switch (type) {
    case 'string':
      return validateString(raw)
    case 'number':
      return validateNumber(raw)
    case 'boolean':
      return validateBoolean(raw)
    default:
      throw new Error(`unsupported type: ${String(type)}`)
  }
}

export function assertEnv<R extends EnvSchema>(required: R): InferEnvSchema<R>
export function assertEnv<R extends EnvSchema, O extends EnvSchema, D extends EnvDefaults<O> = {}>(
  required: R,
  options: AssertEnvOptions<O, D>
): InferEnvSchema<R> & OptionalResult<O, D>
export function assertEnv(
  required: EnvSchema,
  options?: AssertEnvOptions<EnvSchema>
): Record<string, string | number | boolean> {
  const errors: ValidationError[] = []
  const result: Record<string, string | number | boolean> = {}

  for (const [ name, type ] of Object.entries(required)) {
    try {
      result[name] = assertSingleEnv(name, process.env[name], type)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push({ name, message })
    }
  }

  if (options?.optional !== undefined) {
    for (const [ name, type ] of Object.entries(options.optional)) {
      const raw = process.env[name]

      if (raw === undefined || raw.trim() === '') {
        if (options.defaults !== undefined && name in options.defaults) {
          result[name] = (options.defaults as Record<string, string | number | boolean>)[name]!
        }
        continue
      }

      try {
        result[name] = assertSingleEnv(name, raw, type)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push({ name, message })
      }
    }
  }

  // Skip throwing errors if running in knip
  if (process.argv.find(arg => arg.endsWith('/knip.js'))) {
    return result
  }

  if (errors.length > 0) {
    const lines = errors.map(error => `- ${error.name}: ${error.message}`)

    throw new Error(`Invalid environment variables:\n${lines.join('\n')}`)
  }

  if (options?.processEnv) {
    for (const [ name, value ] of Object.entries(result)) {
      process.env[name] = String(value)
    }
  }

  return result
}
