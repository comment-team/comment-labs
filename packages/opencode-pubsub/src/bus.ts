import { mkdir, open, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  claimPath,
  claimsDir,
  cursorPath,
  cursorsDir,
  getBusDir,
  isChannel,
  messagePath,
  messagesDir,
  subscriptionPath,
  subscriptionsDir,
  type Message,
  type Subscription
} from './paths'

const CLAIM_TTL_MS = 60_000

export const MAX_MESSAGE_LENGTH = 16_000

const MESSAGE_NAME_RE = /^(?<seq>\d{6})\.json$/u
const CHANNEL_DIR_RE = /^\d{1,8}$/u

function isNotExist(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function errnoCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined
  }

  const code = error.code

  return typeof code === 'string' ? code : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseMessageFile(raw: string): Message | undefined {
  let value: unknown

  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }

  if (!isRecord(value)) {
    return undefined
  }

  const record = value
  const seq = record.seq
  const channel = record.channel
  const from = record.from
  const directory = record.directory
  const text = record.text
  const createdAt = record.createdAt
  if (
    typeof seq !== 'number'
    || typeof channel !== 'string'
    || typeof from !== 'string'
    || typeof directory !== 'string'
    || typeof text !== 'string'
    || typeof createdAt !== 'string'
  ) {
    return undefined
  }

  return { seq, channel, from, directory, text, createdAt }
}

function parseSubscriptionFile(raw: string): Subscription | undefined {
  let value: unknown

  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }

  if (!isRecord(value)) {
    return undefined
  }

  const record = value
  const sessionID = record.sessionID
  const channel = record.channel
  const serverUrl = record.serverUrl
  const directory = record.directory
  const createdAt = record.createdAt
  if (
    typeof sessionID !== 'string'
    || typeof channel !== 'string'
    || typeof serverUrl !== 'string'
    || typeof directory !== 'string'
    || typeof createdAt !== 'string'
  ) {
    return undefined
  }

  return { sessionID, channel, serverUrl, directory, createdAt }
}

function parseClaimFile(raw: string): number | undefined {
  let value: unknown

  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }

  if (!isRecord(value)) {
    return undefined
  }

  const claimedAt = value.claimedAt

  return typeof claimedAt === 'number' ? claimedAt : undefined
}

function parseCursorFile(raw: string): number {
  let value: unknown

  try {
    value = JSON.parse(raw)
  } catch {
    return 0
  }

  if (!isRecord(value)) {
    return 0
  }

  const lastSeq = value.lastSeq

  return typeof lastSeq === 'number' ? lastSeq : 0
}

function assertChannel(channel: string): void {
  if (!isChannel(channel)) {
    throw new Error(`Invalid pubsub channel ${JSON.stringify(channel)}: channels are referenced by number, e.g. "1"`)
  }
}

function seqFromName(name: string): number | undefined {
  const match = MESSAGE_NAME_RE.exec(name)

  return match?.groups ? Number(match.groups.seq) : undefined
}

export async function highestSeq(channel: string): Promise<number> {
  let names: string[]

  try {
    names = await readdir(messagesDir(getBusDir(), channel))
  } catch (error) {
    if (isNotExist(error)) {
      return 0
    }

    throw error
  }

  let highest = 0

  for (const name of names) {
    const seq = seqFromName(name)
    if (seq !== undefined && seq > highest) {
      highest = seq
    }
  }

  return highest
}

export async function publish(
  channel: string,
  message: { text: string; from: string; directory: string }
): Promise<number> {
  assertChannel(channel)

  if (message.text.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Message exceeds ${MAX_MESSAGE_LENGTH} characters (got ${message.text.length})`)
  }

  const busDir = getBusDir()
  await mkdir(messagesDir(busDir, channel), { recursive: true })

  let seq = (await highestSeq(channel)) + 1

  for (;;) {
    const payload: Message = { seq, channel, ...message, createdAt: new Date().toISOString() }
    const file = messagePath(busDir, channel, seq)

    try {
      const handle = await open(file, 'wx')

      try {
        await handle.writeFile(JSON.stringify(payload))
      } finally {
        await handle.close()
      }

      return seq
    } catch (error) {
      if (errnoCode(error) === 'EEXIST') {
        seq += 1
        continue
      }

      throw error
    }
  }
}

export async function readMessages(channel: string, afterSeq: number): Promise<Message[]> {
  assertChannel(channel)

  let names: string[]

  try {
    names = await readdir(messagesDir(getBusDir(), channel))
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') {
      return []
    }

    throw error
  }

  const messages: Message[] = []

  for (const name of names.sort()) {
    const seq = seqFromName(name)
    if (seq === undefined || seq <= afterSeq) {
      continue
    }

    try {
      const raw = await readFile(messagePath(getBusDir(), channel, seq), 'utf8')
      const message = parseMessageFile(raw)
      if (message !== undefined) {
        messages.push(message)
      }
    } catch {
      // unreadable or concurrently deleted message files are skipped
    }
  }

  return messages
}

export async function listChannels(): Promise<string[]> {
  let names: string[]

  try {
    names = await readdir(join(getBusDir(), 'channels'))
  } catch (error) {
    if (isNotExist(error)) {
      return []
    }

    throw error
  }

  return names.filter(name => CHANNEL_DIR_RE.test(name)).sort()
}

export async function subscribe(subscription: Subscription): Promise<'created' | 'existing'> {
  assertChannel(subscription.channel)

  const busDir = getBusDir()
  await mkdir(subscriptionsDir(busDir, subscription.channel), { recursive: true })

  const file = subscriptionPath(busDir, subscription.channel, subscription.sessionID)

  try {
    const handle = await open(file, 'wx')

    try {
      await handle.writeFile(JSON.stringify(subscription))
    } finally {
      await handle.close()
    }

    return 'created'
  } catch (error) {
    if (errnoCode(error) === 'EEXIST') {
      return 'existing'
    }

    throw error
  }
}

export async function unsubscribe(channel: string, sessionID: string): Promise<void> {
  assertChannel(channel)

  const busDir = getBusDir()
  await rm(subscriptionPath(busDir, channel, sessionID), { force: true })
  await rm(cursorPath(busDir, channel, sessionID), { force: true })
}

export async function listSubscriptions(channel: string): Promise<Subscription[]> {  assertChannel(channel)

  let names: string[]

  try {
    names = await readdir(subscriptionsDir(getBusDir(), channel))
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') {
      return []
    }

    throw error
  }

  const subscriptions: Subscription[] = []
  const dir = subscriptionsDir(getBusDir(), channel)

  for (const name of names.sort()) {
    if (!name.endsWith('.json')) {
      continue
    }

    try {
      const raw = await readFile(join(dir, name), 'utf8')
      const parsed = parseSubscriptionFile(raw)
      if (parsed !== undefined) {
        subscriptions.push(parsed)
      }
    } catch {
      // unreadable or concurrently removed subscription files are skipped
    }
  }

  return subscriptions
}

export async function refreshServerUrls(sessionID: string, serverUrl: string): Promise<void> {
  for (const channel of await listChannels()) {
    const file = subscriptionPath(getBusDir(), channel, sessionID)

    let subscription: Subscription | undefined

    try {
      subscription = parseSubscriptionFile(await readFile(file, 'utf8'))
    } catch {
      continue
    }

    if (subscription !== undefined && subscription.sessionID === sessionID && subscription.serverUrl !== serverUrl) {
      await writeFile(file, JSON.stringify({ ...subscription, serverUrl }), 'utf8')
    }
  }
}

export async function copySubscriptions(fromSessionID: string, toSessionID: string, serverUrl: string, directory: string): Promise<void> {
  for (const channel of await listChannels()) {
    const busDir = getBusDir()

    let parent: Subscription | undefined

    try {
      parent = parseSubscriptionFile(await readFile(subscriptionPath(busDir, channel, fromSessionID), 'utf8'))
    } catch {
      continue
    }

    if (parent === undefined) {
      continue
    }

    const child: Subscription = { ...parent, sessionID: toSessionID, serverUrl, directory, createdAt: new Date().toISOString() }

    await mkdir(subscriptionsDir(busDir, channel), { recursive: true })
    await writeFile(subscriptionPath(busDir, channel, toSessionID), JSON.stringify(child), 'utf8')

    let lastSeq: number

    try {
      lastSeq = parseCursorFile(await readFile(cursorPath(busDir, channel, fromSessionID), 'utf8'))
    } catch {
      lastSeq = await highestSeq(channel)
    }

    await writeCursor(channel, toSessionID, lastSeq)
  }
}

export async function readCursor(channel: string, sessionID: string): Promise<number> {
  try {
    const raw = await readFile(cursorPath(getBusDir(), channel, sessionID), 'utf8')

    return parseCursorFile(raw)
  } catch {
    return 0
  }
}

export async function writeCursor(channel: string, sessionID: string, lastSeq: number): Promise<void> {
  const busDir = getBusDir()
  await mkdir(cursorsDir(busDir, channel), { recursive: true })
  await writeFile(cursorPath(busDir, channel, sessionID), JSON.stringify({ lastSeq }))
}

export async function claimDelivery(channel: string, sessionID: string, seq: number): Promise<boolean> {
  const busDir = getBusDir()
  await mkdir(claimsDir(busDir, channel), { recursive: true })

  const file = claimPath(busDir, channel, seq, sessionID)
  if (await tryCreateClaim(file)) {
    return true
  }

  let claimedAt: number | undefined

  try {
    claimedAt = parseClaimFile(await readFile(file, 'utf8'))
  } catch {
    // missing or corrupt claim files are treated as unclaimed
  }

  if (claimedAt === undefined || Date.now() - claimedAt <= CLAIM_TTL_MS) {
    return false
  }

  await rm(file, { force: true })

  return await tryCreateClaim(file)
}

async function tryCreateClaim(file: string): Promise<boolean> {
  try {
    const handle = await open(file, 'wx')

    try {
      await handle.writeFile(JSON.stringify({ claimedAt: Date.now() }))
    } finally {
      await handle.close()
    }

    return true
  } catch (error) {
    if (errnoCode(error) === 'EEXIST') {
      return false
    }

    throw error
  }
}

export async function releaseClaim(channel: string, sessionID: string, seq: number): Promise<void> {
  await rm(claimPath(getBusDir(), channel, seq, sessionID), { force: true })
}
