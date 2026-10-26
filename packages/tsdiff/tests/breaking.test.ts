import { describe, expect, it } from 'vitest'
import { isCompatible } from '../src/check'
import { inline } from '../src/inline-files'


function errorMessages(result: ReturnType<typeof isCompatible>): string[] {
  return result.success ? [] : result.errors.map(error => error.message)
}

describe('breaking change detection', () => {
  it('should error on removed interface members', () => {
    const result = isCompatible(inline('export interface A { x: number; y: string }', 'export interface A { x: number }'))
    expect(result.success).toBeFalsy()
    expect(errorMessages(result)).toStrictEqual([ 'A from candidate (A) is not assignable to base type (A)' ])
  })

  it('should succeed on narrowed exported value types', () => {
    const result = isCompatible(inline('export const test: string = "x"', 'export const test: "x" = "x"'))
    expect(result.success).toBeTruthy()
  })

  it('should error on missing re-exported names', () => {
    const result = isCompatible(inline('export const test = 1\nexport { test as alias }', 'export const test = 1'))
    expect(result.success).toBeFalsy()
    expect(errorMessages(result)).toStrictEqual([ 'Exported value alias from base is missing in candidate file' ])
  })

  it('should type names re-exported from other modules', () => {
    const result = isCompatible({
      base: 'old.ts',
      candidate: 'new.ts',
      options: {
        files: {
          base: 'export { value } from \'./dep\'',
          candidate: 'export const value = 1',
          'dep.ts': 'export const value = "hello"'
        }
      }
    })
    expect(result.success).toBeFalsy()
    expect(errorMessages(result)).toStrictEqual([ 'value from candidate (1) is not assignable to base type ("hello")' ])
  })

  it('should error on changed default exports', () => {
    const result = isCompatible(inline('export default 42', 'export default 43'))
    expect(result.success).toBeFalsy()
    expect(errorMessages(result)).toStrictEqual([ 'default from candidate (43) is not assignable to base type (42)' ])
  })

  it('should succeed on identical default exports', () => {
    const result = isCompatible(inline('export default function foo(a: number): void {}', 'export default function foo(a: number): void {}'))
    expect(result.success).toBeTruthy()
  })

  it('should error on removed function overloads', () => {
    const oldFile = 'export function f(a: number): void\nexport function f(a: string): void\nexport function f(a: number | string): void {}'
    const newFile = 'export function f(a: string): void\nexport function f(a: number | string): void {}'
    const result = isCompatible(inline(oldFile, newFile))
    expect(result.success).toBeFalsy()
  })

  it('should compare generic types like Promise', () => {
    const result = isCompatible(inline('export const p: Promise<number> = Promise.resolve(1)', 'export const p: Promise<string> = Promise.resolve("x")'))
    expect(result.success).toBeFalsy()
    expect(errorMessages(result)).toStrictEqual([ 'p from candidate (Promise<string>) is not assignable to base type (Promise<number>)' ])
  })

  it('should succeed on identical enums', () => {
    const result = isCompatible(inline('export enum E { A, B }', 'export enum E { A, B }'))
    expect(result.success).toBeTruthy()
  })

  it('should error on removed enum members', () => {
    const result = isCompatible(inline('export enum E { A, B }', 'export enum E { A }'))
    expect(result.success).toBeFalsy()
    expect(errorMessages(result)).toStrictEqual([
      'E from candidate (typeof E) is not assignable to base type (typeof E)',
      'E from base (typeof E) is not assignable to candidate type (typeof E)'
    ])
  })

  it('should error on changed enum member values', () => {
    const result = isCompatible(inline('export enum E { A }', 'export enum E { A = "a" }'))
    expect(result.success).toBeFalsy()
  })

  it('should error on widened exported value types', () => {
    const result = isCompatible(inline('export const test = 1', 'export const test: string | number = "1"'))
    expect(result.success).toBeFalsy()
    expect(errorMessages(result)).toStrictEqual([ 'test from candidate (string | number) is not assignable to base type (1)' ])
  })

  it('should error on literal types widened in value exports', () => {
    const result = isCompatible(inline('export const test = 1', 'export const test: number = 1'))
    expect(result.success).toBeFalsy()
    expect(errorMessages(result)).toStrictEqual([ 'test from candidate (number) is not assignable to base type (1)' ])
  })

  it('should tolerate unresolved imports', () => {
    const result = isCompatible(inline('import \'./missing\'\nexport const test = 1', 'export const test = 2'))
    expect(result.success).toBeFalsy()
    expect(errorMessages(result)).toStrictEqual([ 'test from candidate (2) is not assignable to base type (1)' ])
  })
})
