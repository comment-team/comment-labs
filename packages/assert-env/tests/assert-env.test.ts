import { describe, it, expect, vi } from 'vitest'
import { assertEnv } from '../src/index'


describe('assertEnv', () => {
  it('returns typed string values', () => {
    vi.stubEnv('ACCOUNT_ID', 'abc123')

    const env = assertEnv({
      ACCOUNT_ID: 'string'
    })

    expect(env.ACCOUNT_ID).toBe('abc123')
    vi.unstubAllEnvs()
  })

  it('returns typed number values', () => {
    vi.stubEnv('PORT', '3000')

    const env = assertEnv({
      PORT: 'number'
    })

    expect(env.PORT).toBe(3000)
    vi.unstubAllEnvs()
  })

  it('returns typed boolean values for "true"', () => {
    vi.stubEnv('DEBUG', 'true')

    const env = assertEnv({
      DEBUG: 'boolean'
    })

    expect(env.DEBUG).toBeTruthy()
    vi.unstubAllEnvs()
  })

  it('returns typed boolean values for "false"', () => {
    vi.stubEnv('DEBUG', 'false')

    const env = assertEnv({
      DEBUG: 'boolean'
    })

    expect(env.DEBUG).toBeFalsy()
    vi.unstubAllEnvs()
  })

  it('parses boolean "true" variants case-insensitively', () => {
    vi.stubEnv('A', 'TRUE')
    vi.stubEnv('B', '1')
    vi.stubEnv('C', 'YES')

    const env = assertEnv({
      A: 'boolean',
      B: 'boolean',
      C: 'boolean'
    })

    expect(env.A).toBeTruthy()
    expect(env.B).toBeTruthy()
    expect(env.C).toBeTruthy()
    vi.unstubAllEnvs()
  })

  it('parses boolean "false" variants case-insensitively', () => {
    vi.stubEnv('A', 'False')
    vi.stubEnv('B', '0')
    vi.stubEnv('C', 'no')

    const env = assertEnv({
      A: 'boolean',
      B: 'boolean',
      C: 'boolean'
    })

    expect(env.A).toBeFalsy()
    expect(env.B).toBeFalsy()
    expect(env.C).toBeFalsy()
    vi.unstubAllEnvs()
  })

  it('parses float number values', () => {
    vi.stubEnv('RATIO', '3.14')

    const env = assertEnv({
      RATIO: 'number'
    })

    expect(env.RATIO).toBe(3.14)
    vi.unstubAllEnvs()
  })

  it('parses negative number values', () => {
    vi.stubEnv('OFFSET', '-10')

    const env = assertEnv({
      OFFSET: 'number'
    })

    expect(env.OFFSET).toBe(-10)
    vi.unstubAllEnvs()
  })

  it('parses numbers with surrounding whitespace', () => {
    vi.stubEnv('PORT', '  8080  ')

    const env = assertEnv({
      PORT: 'number'
    })

    expect(env.PORT).toBe(8080)
    vi.unstubAllEnvs()
  })

  it('parses booleans with surrounding whitespace', () => {
    vi.stubEnv('DEBUG', '  true  ')

    const env = assertEnv({
      DEBUG: 'boolean'
    })

    expect(env.DEBUG).toBeTruthy()
    vi.unstubAllEnvs()
  })

  it('parses strings with surrounding whitespace as-is', () => {
    vi.stubEnv('NAME', '  hello  ')

    const env = assertEnv({
      NAME: 'string'
    })

    expect(env.NAME).toBe('  hello  ')
    vi.unstubAllEnvs()
  })

  it('throws when a required string is missing', () => {
    expect(() => assertEnv({ MISSING: 'string' })).toThrow(
      'Invalid environment variables:\n- MISSING: required but not set'
    )
  })

  it('throws when a required number is missing', () => {
    expect(() => assertEnv({ MISSING: 'number' })).toThrow(
      'Invalid environment variables:\n- MISSING: required but not set'
    )
  })

  it('throws when a required boolean is missing', () => {
    expect(() => assertEnv({ MISSING: 'boolean' })).toThrow(
      'Invalid environment variables:\n- MISSING: required but not set'
    )
  })

  it('throws when a required string is empty', () => {
    vi.stubEnv('NAME', '')

    expect(() => assertEnv({ NAME: 'string' })).toThrow(
      'Invalid environment variables:\n- NAME: expected non-empty string, got empty string'
    )
    vi.unstubAllEnvs()
  })

  it('throws when a required string is only whitespace', () => {
    vi.stubEnv('NAME', '   ')

    expect(() => assertEnv({ NAME: 'string' })).toThrow(
      'Invalid environment variables:\n- NAME: expected non-empty string, got empty string'
    )
    vi.unstubAllEnvs()
  })

  it('throws when a required number is not numeric', () => {
    vi.stubEnv('PORT', 'not-a-number')

    expect(() => assertEnv({ PORT: 'number' })).toThrow(
      'Invalid environment variables:\n- PORT: expected number, got "not-a-number"'
    )
    vi.unstubAllEnvs()
  })

  it('throws when a required boolean is not valid', () => {
    vi.stubEnv('DEBUG', 'maybe')

    expect(() => assertEnv({ DEBUG: 'boolean' })).toThrow(
      'Invalid environment variables:\n- DEBUG: expected boolean, got "maybe"'
    )
    vi.unstubAllEnvs()
  })

  it('aggregates all errors into a single throw', () => {
    vi.stubEnv('A', '')
    vi.stubEnv('B', 'not-a-number')
    vi.stubEnv('C', 'maybe')

    expect(() => assertEnv({ A: 'string', B: 'number', C: 'boolean' })).toThrow(
      'Invalid environment variables:\n- A: expected non-empty string, got empty string\n- B: expected number, got "not-a-number"\n- C: expected boolean, got "maybe"'
    )
    vi.unstubAllEnvs()
  })

  it('supports optional variables when present', () => {
    vi.stubEnv('DEBUG', 'true')
    vi.stubEnv('PORT', '8080')

    const env = assertEnv(
      {},
      { optional: { DEBUG: 'boolean', PORT: 'number' } }
    )

    expect(env.DEBUG).toBeTruthy()
    expect(env.PORT).toBe(8080)
    vi.unstubAllEnvs()
  })

  it('omits optional variables when missing', () => {
    const env = assertEnv(
      {},
      { optional: { DEBUG: 'boolean', PORT: 'number' } }
    )

    expect(env.DEBUG).toBeUndefined()
    expect(env.PORT).toBeUndefined()
  })

  it('uses default value for optional variable when env is missing', () => {
    const env = assertEnv(
      {},
      { optional: { DEBUG: 'boolean' }, defaults: { DEBUG: false } }
    )

    expect(env.DEBUG).toBe(false)
  })

  it('uses default value for optional variable when env is empty string', () => {
    vi.stubEnv('DEBUG', '')

    const env = assertEnv(
      {},
      { optional: { DEBUG: 'boolean' }, defaults: { DEBUG: false } }
    )

    expect(env.DEBUG).toBe(false)
    vi.unstubAllEnvs()
  })

  it('uses default value for optional variable when env is whitespace-only', () => {
    vi.stubEnv('DEBUG', '   ')

    const env = assertEnv(
      {},
      { optional: { DEBUG: 'boolean' }, defaults: { DEBUG: false } }
    )

    expect(env.DEBUG).toBe(false)
    vi.unstubAllEnvs()
  })

  it('prefers env value over default when both are present', () => {
    vi.stubEnv('DEBUG', 'true')

    const env = assertEnv(
      {},
      { optional: { DEBUG: 'boolean' }, defaults: { DEBUG: false } }
    )

    expect(env.DEBUG).toBe(true)
    vi.unstubAllEnvs()
  })

  it('supports string defaults for optional variables', () => {
    const env = assertEnv(
      {},
      { optional: { NAME: 'string' }, defaults: { NAME: 'default-name' } }
    )

    expect(env.NAME).toBe('default-name')
  })

  it('supports number defaults for optional variables', () => {
    const env = assertEnv(
      {},
      { optional: { PORT: 'number' }, defaults: { PORT: 3000 } }
    )

    expect(env.PORT).toBe(3000)
  })

  it('still allows undefined for optional variables without defaults', () => {
    const env = assertEnv(
      {},
      { optional: { DEBUG: 'boolean' } }
    )

    expect(env.DEBUG).toBeUndefined()
  })

  it('throws when an optional variable with default has invalid env value', () => {
    vi.stubEnv('DEBUG', 'maybe')

    expect(() => assertEnv(
      {},
      { optional: { DEBUG: 'boolean' }, defaults: { DEBUG: false } }
    )).toThrow(
      'Invalid environment variables:\n- DEBUG: expected boolean, got "maybe"'
    )
    vi.unstubAllEnvs()
  })

  it('adds optional variables with defaults to process.env when processEnv is true', () => {
    assertEnv(
      {},
      { optional: { DEBUG: 'boolean' }, defaults: { DEBUG: true }, processEnv: true }
    )

    expect(process.env.DEBUG).toBe('true')
  })

  it('combines required, optional with defaults, and optional without defaults', () => {
    vi.stubEnv('REQUIRED', 'hello')
    vi.stubEnv('WITH_DEFAULT', 'env-value')

    const env = assertEnv(
      { REQUIRED: 'string' },
      {
        optional: {
          WITH_DEFAULT: 'string',
          WITHOUT_DEFAULT: 'number'
        },
        defaults: { WITH_DEFAULT: 'default-value' }
      }
    )

    expect(env.REQUIRED).toBe('hello')
    expect(env.WITH_DEFAULT).toBe('env-value')
    expect(env.WITHOUT_DEFAULT).toBeUndefined()
    vi.unstubAllEnvs()
  })

  it('omits optional variables when empty string', () => {
    vi.stubEnv('DEBUG', '')

    const env = assertEnv(
      {},
      { optional: { DEBUG: 'boolean' } }
    )

    expect(env.DEBUG).toBeUndefined()
    vi.unstubAllEnvs()
  })

  it('omits optional variables when whitespace-only string', () => {
    vi.stubEnv('DEBUG', '   ')

    const env = assertEnv(
      {},
      { optional: { DEBUG: 'boolean' } }
    )

    expect(env.DEBUG).toBeUndefined()
    vi.unstubAllEnvs()
  })

  it('throws when an optional variable has an invalid value', () => {
    vi.stubEnv('DEBUG', 'maybe')

    expect(() => assertEnv({}, { optional: { DEBUG: 'boolean' } })).toThrow(
      'Invalid environment variables:\n- DEBUG: expected boolean, got "maybe"'
    )
    vi.unstubAllEnvs()
  })

  it('combines required and optional variables', () => {
    vi.stubEnv('NAME', 'test')
    vi.stubEnv('DEBUG', 'true')

    const env = assertEnv(
      { NAME: 'string' },
      { optional: { DEBUG: 'boolean', PORT: 'number' } }
    )

    expect(env.NAME).toBe('test')
    expect(env.DEBUG).toBeTruthy()
    expect(env.PORT).toBeUndefined()
    vi.unstubAllEnvs()
  })

  it('does not mutate process.env by default', () => {
    vi.stubEnv('FOO', 'bar')

    assertEnv({ FOO: 'string' })

    expect(process.env.FOO).toBe('bar')
    vi.unstubAllEnvs()
  })

  it('adds required variables to process.env when processEnv is true', () => {
    vi.stubEnv('REQUIRED_VAR', 'hello')

    assertEnv({ REQUIRED_VAR: 'string' }, { processEnv: true })

    expect(process.env.REQUIRED_VAR).toBe('hello')
    vi.unstubAllEnvs()
  })

  it('adds optional variables to process.env when processEnv is true and they are present', () => {
    vi.stubEnv('OPTIONAL_VAR', '42')

    assertEnv(
      {},
      { optional: { OPTIONAL_VAR: 'number' }, processEnv: true }
    )

    expect(process.env.OPTIONAL_VAR).toBe('42')
    vi.unstubAllEnvs()
  })

  it('does not add missing optional variables to process.env when processEnv is true', () => {
    assertEnv(
      {},
      { optional: { MISSING_OPTIONAL: 'string' }, processEnv: true }
    )

    expect(process.env.MISSING_OPTIONAL).toBeUndefined()
  })

  it('stringifies non-string values when adding to process.env', () => {
    vi.stubEnv('NUM', '123')
    vi.stubEnv('BOOL', 'true')

    assertEnv(
      { NUM: 'number', BOOL: 'boolean' },
      { processEnv: true }
    )

    expect(process.env.NUM).toBe('123')
    expect(process.env.BOOL).toBe('true')
    vi.unstubAllEnvs()
  })
})
