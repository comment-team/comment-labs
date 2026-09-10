import { setTimeout as sleep } from 'node:timers/promises'
import { readMessages } from './bus'
import type { Message } from './paths'

export interface WaitOptions {
  channel: string
  afterSeq: number
  from?: string
  timeoutMs: number
  pollMs?: number
}

export interface WaitResult {
  message: Message | null
  pending: number
}

export async function waitForMessage(options: WaitOptions): Promise<WaitResult> {
  const deadline = Date.now() + options.timeoutMs

  for (;;) {
    let messages = await readMessages(options.channel, options.afterSeq)
    if (options.from !== undefined) {
      messages = messages.filter(message => message.from !== options.from)
    }

    const first = messages[0]
    if (first !== undefined) {
      return { message: first, pending: messages.length - 1 }
    }

    if (Date.now() >= deadline) {
      return { message: null, pending: 0 }
    }

    await sleep(options.pollMs ?? 250)
  }
}
