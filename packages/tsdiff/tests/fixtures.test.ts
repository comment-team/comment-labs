import { describe, expect, it } from 'vitest'
import { isCompatible } from '../src/check'
import { inline } from '../src/inline-files'


function fixture(name: string): string {
  return `tests/fixtures/${name}`
}

describe('fixture tests', () => {

  it('should succeed on empty files', () => {
    expect(isCompatible({
      base: fixture('empty-file/old.ts'),
      candidate: fixture('empty-file/new.ts'),
      options: {}
    })).toMatchInlineSnapshot(`
      {
        "changes": [],
        "errors": [],
        "success": true,
        "warnings": [],
      }
    `)
  })

  it('should succeed on previously empty files', () => {
    expect(isCompatible({
      base: fixture('from-empty-file/old.ts'),
      candidate: fixture('from-empty-file/new.ts'),
      options: {}
    })).toMatchInlineSnapshot(`
      {
        "changes": [
          {
            "message": "Exported value test added in candidate file",
          },
        ],
        "errors": [],
        "success": true,
        "warnings": [],
      }
    `)
  })

  it('should error on now empty files', () => {
    expect(isCompatible({
      base: fixture('to-empty-file/old.ts'),
      candidate: fixture('to-empty-file/new.ts'),
      options: {}
    })).toMatchInlineSnapshot(`
      {
        "changes": [],
        "errors": [
          {
            "message": "Exported value test from base is missing in candidate file",
          },
        ],
        "success": false,
        "warnings": [],
      }
    `)
  })

  it('should error on an accidental breaking change I made', () => {
    expect(isCompatible({
      base: fixture('workers-types-my-bad/old.ts'),
      candidate: fixture('workers-types-my-bad/new.ts'),
      options: {}
    })).toMatchInlineSnapshot(`
      {
        "changes": [],
        "errors": [
          {
            "message": "DurableObject from base (DurableObject) is not assignable to candidate type (DurableObject)",
          },
        ],
        "success": false,
        "warnings": [],
      }
    `)
  })
})

describe('inline fixture tests', () => {
  it('should succeed on empty files', () => {
    expect(isCompatible(inline('', ''))).toMatchInlineSnapshot(`
      {
        "changes": [],
        "errors": [],
        "success": true,
        "warnings": [],
      }
    `)
  })

  it('should succeed on previously empty files', () => {
    expect(isCompatible(inline('', 'export const test = 1\n'))).toMatchInlineSnapshot(`
      {
        "changes": [
          {
            "message": "Exported value test added in candidate file",
          },
        ],
        "errors": [],
        "success": true,
        "warnings": [],
      }
    `)
  })

  it('should error on now empty files', () => {
    expect(isCompatible(inline('export const test = 1\n', ''))).toMatchInlineSnapshot(`
      {
        "changes": [],
        "errors": [
          {
            "message": "Exported value test from base is missing in candidate file",
          },
        ],
        "success": false,
        "warnings": [],
      }
    `)
  })
})
