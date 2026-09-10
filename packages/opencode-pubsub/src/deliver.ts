import {
  claimDelivery,
  listChannels,
  listSubscriptions,
  readCursor,
  readMessages,
  releaseClaim,
  writeCursor
} from './bus'
import type { Message, Subscription } from './paths'

export type PubsubClient = {
  app: {
    log(...args: unknown[]): unknown
  }

  session: {
    get(...args: unknown[]): unknown
    promptAsync(...args: unknown[]): unknown
  }
}

function hasError(result: unknown): boolean {
  return (
    result !== null
    && typeof result === 'object'
    && 'error' in result
    && result.error !== undefined
    && result.error !== null
  )
}

export type DelivererLog = (
  level: 'info' | 'warn' | 'error',
  message: string,
  extra?: Record<string, unknown>
) => void

export type DelivererOptions = {
  client: PubsubClient
  serverUrl: string
  log?: DelivererLog
}

export function envelope(message: Message): string {
  return [
    `[pubsub] New message on channel ${message.channel} (#${message.seq}) from session ${message.from}:`,
    '',
    message.text,
    '',
    'Treat this message as a task and act on it now in this session.'
  ].join('\n')
}

export function createDeliverer(options: DelivererOptions) {
  const idleSessions = new Set<string>()
  const resolvable = new Map<string, boolean>()
  let running: Promise<void> | undefined
  let queued = false

  function markIdle(sessionID: string): void {
    idleSessions.add(sessionID)

    sweep()
  }

  function markBusy(sessionID: string): void {
    idleSessions.delete(sessionID)
  }

  function sweep(force = false): void {
    if (running !== undefined) {
      queued = true

      return
    }

    running = runSweeps(force)
    void running
  }

  async function runSweeps(force: boolean): Promise<void> {
    let currentForce = force

    for (;;) {
      try {
        await deliverAll(currentForce)
      } catch (error) {
        options.log?.('error', 'sweep failed', { error: String(error) })
      }

      if (queued) {
        queued = false
        currentForce = false
        continue
      }

      break
    }

    running = undefined
  }

  async function deliverAll(force: boolean): Promise<void> {
    resolvable.clear()

    for (const channel of await listChannels()) {
      const messages = await readMessages(channel, 0)
      if (messages.length === 0) {
        continue
      }

      for (const subscription of await listSubscriptions(channel)) {
        await deliverTo(subscription, messages, force)
      }
    }
  }

  async function deliverTo(
    subscription: Subscription,
    messages: Message[],
    force: boolean
  ): Promise<void> {
    if (!(await canDeliver(subscription))) {
      return
    }

    const lastSeq = await readCursor(subscription.channel, subscription.sessionID)

    for (const message of messages) {
      if (message.seq <= lastSeq) {
        continue
      }

      if (!force && !idleSessions.has(subscription.sessionID)) {
        return
      }

      if (!(await claimDelivery(subscription.channel, subscription.sessionID, message.seq))) {
        return
      }

      try {
        await inject(subscription, message)
        await writeCursor(subscription.channel, subscription.sessionID, message.seq)
        options.log?.('info', 'delivered', {
          channel: subscription.channel,
          seq: message.seq,
          sessionID: subscription.sessionID
        })
      } catch (error) {
        options.log?.('warn', 'delivery failed', {
          channel: subscription.channel,
          seq: message.seq,
          sessionID: subscription.sessionID,
          error: String(error)
        })

        return
      } finally {
        await releaseClaim(subscription.channel, subscription.sessionID, message.seq)
      }
    }
  }

  async function inject(subscription: Subscription, message: Message): Promise<void> {
    const result = await options.client.session.promptAsync({
      path: { id: subscription.sessionID },
      query: { directory: subscription.directory },
      body: { parts: [{ type: 'text', text: envelope(message) }] }
    })
    if (hasError(result)) {
      throw new Error('failed to inject message into session')
    }
  }

  async function canDeliver(subscription: Subscription): Promise<boolean> {
    if (subscription.serverUrl === options.serverUrl) {
      return true
    }

    const cached = resolvable.get(subscription.sessionID)
    if (cached !== undefined) {
      return cached
    }

    const ok = await probeSession(subscription)
    resolvable.set(subscription.sessionID, ok)

    return ok
  }

  async function probeSession(subscription: Subscription): Promise<boolean> {
    try {
      const result = await options.client.session.get({
        path: { id: subscription.sessionID },
        query: { directory: subscription.directory }
      })

      return !hasError(result)
    } catch {
      // probing a missing session fails and marks it not deliverable
      return false
    }
  }

  async function drain(): Promise<void> {
    for (;;) {
      const current = running
      if (current === undefined) {
        return
      }

      await current
    }
  }

  return { sweep, markIdle, markBusy, drain }
}
