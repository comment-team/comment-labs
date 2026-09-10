import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

type Env = Record<string, string | undefined>

const env = (globalThis as { process?: { env?: Env } }).process?.env

const CHANNEL_RE = /^\d{1,8}$/u

export type Message = {
  seq: number
  channel: string
  text: string
  from: string
  directory: string
  createdAt: string
}

export type Subscription = {
  sessionID: string
  channel: string
  serverUrl: string
  directory: string
  createdAt: string
}

export function getBusDir(): string {
  const override = env?.OPENCODE_PUBSUB_DIR
  if (override !== undefined && override !== '') {
    return resolve(override)
  }

  return join(env?.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'opencode-pubsub')
}

export function isChannel(channel: string): boolean {
  return CHANNEL_RE.test(channel)
}

export function messagesDir(busDir: string, channel: string): string {
  return join(busDir, 'channels', channel, 'messages')
}

export function subscriptionsDir(busDir: string, channel: string): string {
  return join(busDir, 'channels', channel, 'subscriptions')
}

export function cursorsDir(busDir: string, channel: string): string {
  return join(busDir, 'channels', channel, 'cursors')
}

export function claimsDir(busDir: string, channel: string): string {
  return join(busDir, 'channels', channel, 'claims')
}

export function messagePath(busDir: string, channel: string, seq: number): string {
  return join(messagesDir(busDir, channel), `${String(seq).padStart(6, '0')}.json`)
}

export function subscriptionPath(busDir: string, channel: string, sessionID: string): string {
  return join(subscriptionsDir(busDir, channel), `${sessionID}.json`)
}

export function cursorPath(busDir: string, channel: string, sessionID: string): string {
  return join(cursorsDir(busDir, channel), `${sessionID}.json`)
}

export function claimPath(busDir: string, channel: string, seq: number, sessionID: string): string {
  return join(claimsDir(busDir, channel), `${seq}.${sessionID}.json`)
}
