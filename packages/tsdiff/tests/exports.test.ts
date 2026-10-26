import { describe, expect, it } from 'vitest'
import { isCompatible } from '../src/check'
import { inline } from '../src/inline-files'


describe('export tests', () => {
  it('should error on type changes in globals', () => {
    expect(isCompatible(inline('export const test = 1', 'export const test = "1"'))).toMatchInlineSnapshot(`
      {
        "changes": [],
        "errors": [
          {
            "message": "test from candidate ("1") is not assignable to base type (1)",
          },
        ],
        "success": false,
        "warnings": [],
      }
    `)
  })

  it('should error on type widened in globals', () => {
    expect(isCompatible(inline('export const test = 1', 'export const test: string | number = "1"'))).toMatchInlineSnapshot(`
      {
        "changes": [],
        "errors": [
          {
            "message": "test from candidate (string | number) is not assignable to base type (1)",
          },
        ],
        "success": false,
        "warnings": [],
      }
    `)
  })

  it('should error on literal widened to type in globals', () => {
    expect(isCompatible(inline('export const test = 1', 'export const test: number = 1'))).toMatchInlineSnapshot(`
      {
        "changes": [],
        "errors": [
          {
            "message": "test from candidate (number) is not assignable to base type (1)",
          },
        ],
        "success": false,
        "warnings": [],
      }
    `)
  })

  it('should succeed on type->value export change', () => {
    expect(isCompatible(inline('export type test = 1', 'export const test = 1'))).toMatchInlineSnapshot(`
      {
        "changes": [],
        "errors": [],
        "success": true,
        "warnings": [],
      }
    `)
  })
})
