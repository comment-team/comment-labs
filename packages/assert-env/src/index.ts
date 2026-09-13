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
type EmptyObject = Record<never, never>
type OptionalResult<O extends EnvSchema, D extends EnvDefaults<O> = EmptyObject> = {
  [K in keyof O as K extends keyof D ? never : K]?: TypeMap[O[K]] | undefined
} & {
  [K in keyof O as K extends keyof D ? K : never]: TypeMap[O[K]]
}

export interface AssertEnvOptions<O extends EnvSchema, D extends EnvDefaults<O> = EmptyObject> {
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

  if (trimmed === '' || Number.isNaN(parsed)) {
    throw new Error(`expected number, got "${raw}"`)
  }

  return parsed
}

function validateBoolean(raw: string): boolean {
  const normalized = raw.trim().toLowerCase()

  if ([ 'true', '1', 'yes' ].includes(normalized)) {
    return true
  }

  if ([ 'false', '0', 'no' ].includes(normalized)) {
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
export function assertEnv<R extends EnvSchema, O extends EnvSchema, D extends EnvDefaults<O> = EmptyObject>(
  required: R,
  options: AssertEnvOptions<O, D>
): InferEnvSchema<R> & OptionalResult<O, D>
export function assertEnv(
  required: EnvSchema,
  options?: AssertEnvOptions<EnvSchema, EnvDefaults<EnvSchema>>
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
        const value = options.defaults?.[name]

        if (value !== undefined) {
          result[name] = value
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
  if (process.argv.some(arg => arg.endsWith('/knip.js'))) {
    return result
  }

  if (errors.length > 0) {
    const lines = errors.map(error => `- ${error.name}: ${error.message}`)

    throw new Error(`Invalid environment variables:\n${lines.join('\n')}`)
  }

  if (options?.processEnv === true) {
    for (const [ name, value ] of Object.entries(result)) {
      process.env[name] = String(value)
    }
  }

  return result
}
