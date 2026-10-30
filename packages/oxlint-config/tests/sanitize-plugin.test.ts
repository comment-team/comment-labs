import { describe, it, expect } from 'vitest'
import { sanitizePlugin } from '../src/sanitize-plugin'


describe('sanitizePlugin', () => {
  it('truncates defaultOptions at the first nullish entry', () => {
    const plugin = {
      rules: {
        broken: { meta: { defaultOptions: [ undefined ] } },
        explicitNull: { meta: { defaultOptions: [ null ] } },
        prefix: { meta: { defaultOptions: [ 'always', undefined, { enforceForIfStatements: true }] } }
      }
    }

    const sanitized = sanitizePlugin(plugin)

    expect(sanitized.rules?.broken?.meta?.defaultOptions).toStrictEqual([])
    expect(sanitized.rules?.explicitNull?.meta?.defaultOptions).toStrictEqual([])
    expect(sanitized.rules?.prefix?.meta?.defaultOptions).toStrictEqual([ 'always' ])
  })

  it('keeps rules without nullish defaultOptions untouched by reference', () => {
    const cleanRule = { meta: { defaultOptions: [ 'always' ] } }
    const noDefaultsRule = { meta: {} }

    const sanitized = sanitizePlugin({ rules: { clean: cleanRule, noDefaults: noDefaultsRule } })

    expect(sanitized.rules?.clean).toBe(cleanRule)
    expect(sanitized.rules?.noDefaults).toBe(noDefaultsRule)
  })

  it('preserves non-meta rule properties when sanitizing', () => {
    const plugin = {
      meta: { name: 'test' },
      extra: 'kept',
      rules: {
        broken: {
          create: () => ({}),
          meta: {
            defaultOptions: [ undefined ],
            messages: { unexpected: 'Unexpected.' }
          }
        }
      }
    }

    const sanitized = sanitizePlugin(plugin)

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const broken = sanitized.rules?.broken as typeof plugin.rules.broken

    expect(broken.meta.defaultOptions).toStrictEqual([])
    expect(broken.meta.messages).toStrictEqual({ unexpected: 'Unexpected.' })
    expect(broken.create).toBe(plugin.rules.broken.create)
  })

  it('returns plugins without rules as-is', () => {
    expect(sanitizePlugin({ meta: { name: 'empty' } })).toStrictEqual({ meta: { name: 'empty' } })
  })

  it('handles rules without meta or without defaultOptions', () => {
    const plugin = {
      rules: {
        noDefaults: { create: () => ({}) },
        noMeta: { create: () => ({}) },
        nullMeta: { meta: null, create: () => ({}) }
      }
    }

    const sanitized = sanitizePlugin(plugin)

    expect(sanitized.rules?.noDefaults).toBe(plugin.rules.noDefaults)
    expect(sanitized.rules?.noMeta).toBe(plugin.rules.noMeta)
    expect(sanitized.rules?.nullMeta).toBe(plugin.rules.nullMeta)
  })
})
