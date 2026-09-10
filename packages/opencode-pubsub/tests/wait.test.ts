import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { publish } from '../src/bus'
import { waitForMessage } from '../src/wait'

const publishMessage = async (text: string, from = 's1'): Promise<number> => await publish('1', { text, from, directory: '/w' })

describe('waitForMessage', () => {
  let busDir: string

  beforeEach(async () => {
    busDir = await mkdtemp(join(tmpdir(), 'opencode-pubsub-wait-'))
    process.env.OPENCODE_PUBSUB_DIR = busDir
  })

  afterEach(async () => {
    delete process.env.OPENCODE_PUBSUB_DIR
    await rm(busDir, { recursive: true, force: true })
  })

  it('returns immediately when a message already exists after the cursor', async () => {
    await publishMessage('hello')

    const result = await waitForMessage({ channel: '1', afterSeq: 0, timeoutMs: 1000, pollMs: 10 })
    expect(result.message).toMatchObject({ seq: 1, text: 'hello', from: 's1' })
    expect(result.pending).toBe(0)
  })

  it('returns the first new message and reports pending ones', async () => {
    await publishMessage('a')
    await publishMessage('b')
    await publishMessage('c')

    const result = await waitForMessage({ channel: '1', afterSeq: 0, timeoutMs: 1000, pollMs: 10 })
    expect(result.message).toMatchObject({ seq: 1, text: 'a' })
    expect(result.pending).toBe(2)
  })

  it('ignores messages from the excluded session', async () => {
    const seq = await publishMessage('from me', 'me')
    const result = await waitForMessage({ channel: '1', afterSeq: 0, from: 'me', timeoutMs: 100, pollMs: 10 })
    expect(result.message).toBeNull()
    expect(seq).toBe(1)
  })

  it('returns null on timeout when nothing arrives', async () => {
    const start = Date.now()
    const result = await waitForMessage({ channel: '1', afterSeq: 0, timeoutMs: 150, pollMs: 25 })
    expect(result.message).toBeNull()
    expect(result.pending).toBe(0)
    expect(Date.now() - start).toBeGreaterThanOrEqual(150)
  })

  it('resolves while waiting when a message is published mid-wait', async () => {
    const wait = waitForMessage({ channel: '1', afterSeq: 0, timeoutMs: 5000, pollMs: 20 })
    await sleep(100)
    await publishMessage('late reply', 's2')

    const result = await wait
    expect(result.message).toMatchObject({ seq: 1, text: 'late reply', from: 's2' })
  })
})
