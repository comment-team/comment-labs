import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

// isolate the state file: state.ts resolves XDG_DATA_HOME at module load
const dataHome = mkdtempSync(join(tmpdir(), 'iv-state-'))
process.env.XDG_DATA_HOME = dataHome

const UNSUPPORTED_TYPE_REGEX = /unsupported image type/u
const NOT_FOUND_REGEX = /image not found/u

describe('state', () => {
  it('validates + accumulates images per session', async () => {
    expect.assertions(8)

    const { prepareImages, answerFromParts } = await import('../src/state')
    const dir = mkdtempSync(join(tmpdir(), 'iv-'))
    const png = join(dir, 'a.png')
    writeFileSync(png, 'x')

    const s1 = 'sess-1'
    const p1 = await prepareImages(s1, [ png ], dir)

    expect(p1.added).toStrictEqual([ png ])
    expect(p1.view.images).toHaveLength(1)

    // duplicate → skipped, not re-added
    const p2 = await prepareImages(s1, [ png ], dir)

    expect(p2.skipped).toStrictEqual([ png ])
    expect(p2.view.images).toHaveLength(1)
    // unknown type rejected
    await expect(prepareImages(s1, [ join(dir, 'b.txt') ], dir)).rejects.toThrow(UNSUPPORTED_TYPE_REGEX)
    // missing file rejected
    await expect(prepareImages(s1, [ join(dir, 'nope.png') ], dir)).rejects.toThrow(NOT_FOUND_REGEX)

    expect(answerFromParts([{ type: 'text', text: 'hello' }, { type: 'file' }])).toBe('hello')
    expect(answerFromParts()).toBe('')
  })
})
