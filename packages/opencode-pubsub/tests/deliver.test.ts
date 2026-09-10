import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { publish, readCursor, subscribe } from '../src/bus'
import { createDeliverer, type DelivererLog, type PubsubClient } from '../src/deliver'
import type { Subscription } from '../src/paths'

type InjectedMessage = { sessionID: string; text: string; directory?: string }

const noopLog: DelivererLog = () => null

function fakeClient(options: { knownSessions?: Set<string>; failInject?: boolean } = {}) {
  const knownSessions = options.knownSessions ?? new Set<string>()
  const injected: InjectedMessage[] = []
  const client: PubsubClient = {
    app: {
      log: () => null
    },
    session: {
      get: ({ path }: { path: { id: string } }) => {
        if (!knownSessions.has(path.id)) {
          return { error: 'not found' }
        }

        return { error: null }
      },
      promptAsync: ({
        path,
        query,
        body
      }: {
        path: { id: string }
        query?: { directory?: string }
        body: { parts: { text: string }[] }
      }) => {
        if (options.failInject === true) {
          throw new Error('inject failed')
        }

        injected.push({
          sessionID: path.id,
          text: body.parts[0]?.text ?? '',
          directory: query?.directory
        })

        return { error: null }
      }
    }
  }

  return { client, injected }
}

const subscription = (sessionID: string, serverUrl = 'http://127.0.0.1:1'): Subscription => ({
  sessionID,
  channel: '1',
  serverUrl,
  directory: '/tmp/project',
  createdAt: '2026-01-01T00:00:00.000Z'
})

describe('deliverer', () => {
  let busDir: string

  beforeEach(async () => {
    busDir = await mkdtemp(join(tmpdir(), 'opencode-pubsub-'))
    process.env.OPENCODE_PUBSUB_DIR = busDir
  })

  afterEach(async () => {
    delete process.env.OPENCODE_PUBSUB_DIR
    await rm(busDir, { recursive: true, force: true })
  })

  it('delivers pending messages to an idle subscriber and advances the cursor', async () => {
    const { client, injected } = fakeClient()
    await subscribe(subscription('ses_b', 'http://mine'))
    await publish('1', { text: 'do it', from: 'ses_a', directory: '/tmp/project' })

    const deliverer = createDeliverer({ client, serverUrl: 'http://mine', log: noopLog })
    deliverer.markIdle('ses_b')
    deliverer.sweep()
    await deliverer.drain()
    expect(injected).toHaveLength(1)

    const [ first ] = injected
    expect(first?.sessionID).toBe('ses_b')
    expect(first?.text).toContain('do it')
    await expect(readCursor('1', 'ses_b')).resolves.toBe(1)
  })

  it('delivers messages oldest first in one sweep', async () => {
    const { client, injected } = fakeClient()
    await subscribe(subscription('ses_b', 'http://mine'))
    await publish('1', { text: 'first', from: 'ses_a', directory: '/tmp/project' })
    await publish('1', { text: 'second', from: 'ses_a', directory: '/tmp/project' })

    const deliverer = createDeliverer({ client, serverUrl: 'http://mine', log: noopLog })
    deliverer.markIdle('ses_b')
    deliverer.sweep()
    await deliverer.drain()
    expect(injected).toHaveLength(2)

    const [ firstDelivered, secondDelivered ] = injected
    expect(firstDelivered?.text).toContain('first')
    expect(secondDelivered?.text).toContain('second')
    await expect(readCursor('1', 'ses_b')).resolves.toBe(2)
  })

  it('holds delivery until the session goes idle', async () => {
    const { client, injected } = fakeClient()
    await subscribe(subscription('ses_b', 'http://mine'))
    await publish('1', { text: 'do it', from: 'ses_a', directory: '/tmp/project' })

    const deliverer = createDeliverer({ client, serverUrl: 'http://mine', log: noopLog })
    deliverer.sweep()
    await deliverer.drain()
    expect(injected).toHaveLength(0)
    deliverer.markIdle('ses_b')
    deliverer.sweep()
    await deliverer.drain()
    expect(injected).toHaveLength(1)
  })

  it('delivers on a forced sweep without a prior idle signal', async () => {
    const { client, injected } = fakeClient()
    await subscribe(subscription('ses_b', 'http://mine'))
    await publish('1', { text: 'do it', from: 'ses_a', directory: '/tmp/project' })

    const deliverer = createDeliverer({ client, serverUrl: 'http://mine', log: noopLog })
    deliverer.sweep(true)
    await deliverer.drain()
    expect(injected).toHaveLength(1)
  })

  it('ignores subscriptions it cannot resolve', async () => {
    const { client, injected } = fakeClient()
    await subscribe(subscription('ses_b', 'http://other'))
    await publish('1', { text: 'do it', from: 'ses_a', directory: '/tmp/project' })

    const deliverer = createDeliverer({ client, serverUrl: 'http://mine', log: noopLog })
    deliverer.markIdle('ses_b')
    deliverer.sweep()
    await deliverer.drain()
    expect(injected).toHaveLength(0)
    await expect(readCursor('1', 'ses_b')).resolves.toBe(0)
  })

  it('delivers cross-server subscriptions whose session is resolvable', async () => {
    const { client, injected } = fakeClient({ knownSessions: new Set([ 'ses_b' ]) })
    await subscribe(subscription('ses_b', 'http://other'))
    await publish('1', { text: 'do it', from: 'ses_a', directory: '/tmp/project' })

    const deliverer = createDeliverer({ client, serverUrl: 'http://mine', log: noopLog })
    deliverer.markIdle('ses_b')
    deliverer.sweep()
    await deliverer.drain()
    expect(injected).toHaveLength(1)
  })

  it('keeps the message when injection fails and retries later', async () => {
    let failInject = true
    const { injected } = fakeClient()
    const client: PubsubClient = {
      app: {
        log: () => null
      },
      session: {
        get: () => ({ error: null }),
        promptAsync: (options: {
          path: { id: string }
          query?: { directory?: string }
          body: { parts: { text: string }[] }
        }) => {
          if (failInject) {
            throw new Error('inject failed')
          }

          injected.push({
            sessionID: options.path.id,
            text: options.body.parts[0]?.text ?? '',
            directory: options.query?.directory
          })

          return { error: null }
        }
      }
    }
    await subscribe(subscription('ses_b', 'http://mine'))
    await publish('1', { text: 'do it', from: 'ses_a', directory: '/tmp/project' })

    const deliverer = createDeliverer({ client, serverUrl: 'http://mine', log: noopLog })
    deliverer.markIdle('ses_b')
    deliverer.sweep()
    await deliverer.drain()
    expect(injected).toHaveLength(0)
    await expect(readCursor('1', 'ses_b')).resolves.toBe(0)
    failInject = false
    deliverer.sweep()
    await deliverer.drain()
    expect(injected).toHaveLength(1)
    await expect(readCursor('1', 'ses_b')).resolves.toBe(1)
  })

  it('treats a session as busy again after delivery', async () => {
    const { client, injected } = fakeClient()
    await subscribe(subscription('ses_b', 'http://mine'))
    await publish('1', { text: 'first', from: 'ses_a', directory: '/tmp/project' })

    const deliverer = createDeliverer({ client, serverUrl: 'http://mine', log: noopLog })
    deliverer.markIdle('ses_b')
    deliverer.sweep()
    await deliverer.drain()
    expect(injected).toHaveLength(1)
    await publish('1', { text: 'second', from: 'ses_a', directory: '/tmp/project' })
    deliverer.markBusy('ses_b')
    deliverer.sweep()
    await deliverer.drain()
    expect(injected).toHaveLength(1)
    deliverer.markIdle('ses_b')
    deliverer.sweep()
    await deliverer.drain()
    expect(injected).toHaveLength(2)
  })
})
