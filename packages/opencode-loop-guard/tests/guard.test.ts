import { describe, expect, it } from 'vitest'
import { LoopTracker } from '../src/core'

describe('loop tracker', () => {
  it('blocks only after N identical consecutive calls', () => {
    expect.assertions(4)

    const t = new LoopTracker({ threshold: 3 })
    expect(t.observe('s1', 'bash', { command: 'ls' })).toBeUndefined()
    expect(t.observe('s1', 'bash', { command: 'ls' })).toBeUndefined()
    expect(t.observe('s1', 'bash', { command: 'ls' })).toContain('loop-guard BLOCKED')
    // counter reset after blocking — the next call is allowed again
    expect(t.observe('s1', 'bash', { command: 'ls' })).toBeUndefined()
  })

  it('different args reset the streak', () => {
    expect.assertions(2)

    const t = new LoopTracker({ threshold: 3 })
    t.observe('s1', 'bash', { command: 'ls' })
    expect(t.observe('s1', 'bash', { command: 'ls -la' })).toBeUndefined()
    t.observe('s1', 'bash', { command: 'ls' })
    t.observe('s1', 'bash', { command: 'ls' })
    expect(t.observe('s1', 'bash', { command: 'ls' })).toContain('BLOCKED')
  })

  it('sessions are independent', () => {
    expect.assertions(2)

    const t = new LoopTracker({ threshold: 2 })
    t.observe('a', 'bash', { command: 'x' })
    expect(t.observe('b', 'bash', { command: 'x' })).toBeUndefined()
    expect(t.observe('a', 'bash', { command: 'x' })).toContain('BLOCKED')
  })

  it('hashes are order-insensitive for object keys', () => {
    expect.assertions(1)

    expect(LoopTracker.hashArgs({ a: 1, b: [ 1, { y: 2, x: 1 }] })).toBe(
      LoopTracker.hashArgs({ b: [ 1, { x: 1, y: 2 }], a: 1 })
    )
  })
})
