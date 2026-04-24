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
})
