import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  claimDelivery,
  copySubscriptions,
  highestSeq,
  listChannels,
  listSubscriptions,
  publish,
  readCursor,
  readMessages,
  refreshServerUrls,
  releaseClaim,
  subscribe,
  unsubscribe,
  writeCursor
} from '../src/bus'
import type { Subscription } from '../src/paths'

type TestSubscription = (sessionID: string, channel?: string) => Subscription

const subscription: TestSubscription = (sessionID, channel = '1') => ({
  sessionID,
  channel,
  serverUrl: 'http://127.0.0.1:1',
  directory: '/tmp/project',
  createdAt: '2026-01-01T00:00:00.000Z'
})

describe('bus', () => {
  let busDir: string

  beforeEach(async () => {
    busDir = await mkdtemp(join(tmpdir(), 'opencode-pubsub-'))
    process.env.OPENCODE_PUBSUB_DIR = busDir
  })

  afterEach(async () => {
    delete process.env.OPENCODE_PUBSUB_DIR
    await rm(busDir, { recursive: true, force: true })
  })

  describe('publish', () => {
    it('allocates sequential message ids per channel', async () => {
      await expect(publish('1', { text: 'a', from: 's1', directory: '/w' })).resolves.toBe(1)
      await expect(publish('1', { text: 'b', from: 's1', directory: '/w' })).resolves.toBe(2)
      await expect(publish('2', { text: 'c', from: 's2', directory: '/w' })).resolves.toBe(1)
    })

    it('persists message content', async () => {
      await publish('1', { text: 'hello', from: 's1', directory: '/w' })

      const messages = await readMessages('1', 0)
      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatchObject({ seq: 1, channel: '1', text: 'hello', from: 's1' })
    })

    it('reads only messages after a sequence number', async () => {
      await publish('1', { text: 'a', from: 's1', directory: '/w' })
      await publish('1', { text: 'b', from: 's1', directory: '/w' })

      const messages = await readMessages('1', 1)
      expect(messages.map(message => message.text)).toStrictEqual([ 'b' ])
    })

    it('rejects messages longer than 16k characters', async () => {
      const long = 'x'.repeat(16_001)
      await expect(publish('1', { text: long, from: 's1', directory: '/w' })).rejects.toThrow(
        'Message exceeds 16000 characters'
      )

      const exactly = 'x'.repeat(16_000)
      await expect(publish('1', { text: exactly, from: 's1', directory: '/w' })).resolves.toBe(1)
    })

    it('rejects invalid channels', async () => {
      await expect(publish('abc', { text: 'x', from: 's1', directory: '/w' })).rejects.toThrow('Invalid pubsub channel')
      await expect(publish('', { text: 'x', from: 's1', directory: '/w' })).rejects.toThrow('Invalid pubsub channel')
    })
  })

  describe('subscriptions', () => {
    it('stores subscriptions idempotently', async () => {
      await expect(subscribe(subscription('ses_a'))).resolves.toBe('created')
      await expect(subscribe(subscription('ses_a'))).resolves.toBe('existing')
      await expect(listSubscriptions('1')).resolves.toStrictEqual([ subscription('ses_a') ])
    })

    it('removes subscriptions and cursors', async () => {
      await subscribe(subscription('ses_a'))
      await writeCursor('1', 'ses_a', 5)
      await unsubscribe('1', 'ses_a')
      await expect(listSubscriptions('1')).resolves.toStrictEqual([])
      await expect(readCursor('1', 'ses_a')).resolves.toBe(0)
    })
  })

  describe('cursors', () => {
    it('tracks the last delivered sequence', async () => {
      await expect(readCursor('1', 'ses_a')).resolves.toBe(0)
      await writeCursor('1', 'ses_a', 7)
      await expect(readCursor('1', 'ses_a')).resolves.toBe(7)
    })
  })

  describe('claims', () => {
    it('is exclusive per session and sequence', async () => {
      await expect(claimDelivery('1', 'ses_a', 1)).resolves.toBeTruthy()
      await expect(claimDelivery('1', 'ses_b', 1)).resolves.toBeTruthy()
      await expect(claimDelivery('1', 'ses_a', 1)).resolves.toBeFalsy()
      await releaseClaim('1', 'ses_a', 1)
      await expect(claimDelivery('1', 'ses_a', 1)).resolves.toBeTruthy()
    })
  })

  describe('refreshServerUrls', () => {
    it('rewrites the server url of stale subscriptions for the given session only', async () => {
      await subscribe(subscription('s1', '1'))
      await subscribe(subscription('s2', '1'))
      await subscribe(subscription('s1', '2'))

      await refreshServerUrls('s1', 'http://127.0.0.1:2')

      const one = await listSubscriptions('1')
      expect(one.find(s => s.sessionID === 's1')?.serverUrl).toBe('http://127.0.0.1:2')
      expect(one.find(s => s.sessionID === 's2')?.serverUrl).toBe('http://127.0.0.1:1')
      const two = await listSubscriptions('2')
      expect(two.find(s => s.sessionID === 's1')?.serverUrl).toBe('http://127.0.0.1:2')
    })

    it('leaves subscriptions untouched when the server url already matches', async () => {
      await subscribe(subscription('s1', '1'))

      const before = await readFile(join(busDir, 'channels', '1', 'subscriptions', 's1.json'), 'utf8')
      await refreshServerUrls('s1', 'http://127.0.0.1:1')
      const after = await readFile(join(busDir, 'channels', '1', 'subscriptions', 's1.json'), 'utf8')

      expect(after).toBe(before)
    })
  })

  describe('channels', () => {
    it('lists channels that have messages', async () => {
      await expect(listChannels()).resolves.toStrictEqual([])
      await publish('2', { text: 'x', from: 's1', directory: '/w' })
      await publish('10', { text: 'x', from: 's1', directory: '/w' })
      await expect(listChannels()).resolves.toStrictEqual([ '10', '2' ])
    })
  })

  describe('copySubscriptions', () => {
    it('copies the parent subscription and cursor to the child session', async () => {
      await subscribe({ ...subscription('parent'), serverUrl: 'http://127.0.0.1:1' })
      await publish('1', { text: 'hello', from: 'p1', directory: '/w' })
      await publish('1', { text: 'again', from: 'p1', directory: '/w' })
      await writeCursor('1', 'parent', 2)

      await copySubscriptions('parent', 'child', 'http://127.0.0.1:2', '/tmp/fork')

      const subs = await listSubscriptions('1')
      expect(subs.map(subscription => subscription.sessionID).sort()).toStrictEqual(['child', 'parent'])

      const child = subs.find(subscription => subscription.sessionID === 'child')
      expect(child?.serverUrl).toBe('http://127.0.0.1:2')
      expect(child?.directory).toBe('/tmp/fork')

      expect(await readCursor('1', 'child')).toBe(2)
    })

    it('starts the child after the newest message when the parent has no cursor', async () => {
      await subscribe(subscription('parent2'))
      await publish('1', { text: 'one', from: 'p1', directory: '/w' })
      await publish('1', { text: 'two', from: 'p1', directory: '/w' })

      await copySubscriptions('parent2', 'child2', 'http://127.0.0.1:2', '/tmp/fork')

      expect(await readCursor('1', 'child2')).toBe(await highestSeq('1'))
    })

    it('does nothing when the parent has no subscriptions', async () => {
      await copySubscriptions('lonely', 'child3', 'http://127.0.0.1:2', '/tmp/fork')

      expect(await listSubscriptions('1')).toHaveLength(0)
    })
  })
})
