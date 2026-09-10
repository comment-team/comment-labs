import type { Plugin } from '@opencode-ai/plugin'
import { tool } from '@opencode-ai/plugin/tool'
import { copySubscriptions, highestSeq, publish, refreshServerUrls, subscribe, unsubscribe } from './bus'
import { createDeliverer, type DelivererLog, type PubsubClient } from './deliver'
import { getBusDir, isChannel } from './paths'
import { watchBus } from './watcher'
import { waitForMessage } from './wait'

function channelHint(channel: string): string {
  return `Invalid pubsub channel ${JSON.stringify(channel)}: channels are referenced by number, e.g. "1".`
}

async function logAsync(
  client: PubsubClient,
  level: 'info' | 'warn' | 'error',
  message: string,
  extra?: Record<string, unknown>
): Promise<void> {
  return await (async () => {
    try {
      await client.app.log({ body: { service: 'opencode-pubsub', level, message, extra } })
    } catch {
      // logging failures are non-fatal and ignored
    }
  })()
}

function makeLog(client: PubsubClient): DelivererLog {
  return (level, message, extra) => {
    void logAsync(client, level, message, extra)
  }
}

export const Pubsub: Plugin = async ({ client, serverUrl }) => {
  const deliverer = createDeliverer({ client, serverUrl: String(serverUrl), log: makeLog(client) })

  await watchBus(getBusDir(), () => {
    deliverer.sweep()
  })

  deliverer.sweep(true)

  return {
    event: async ({ event }) => {
      if (event.type === 'session.created') {
        const info = event.properties.info

        if (info.parentID !== undefined) {
          await copySubscriptions(info.parentID, info.id, String(serverUrl), info.directory)
        }

        return
      }

      if (event.type === 'session.idle') {
        deliverer.markIdle(event.properties.sessionID)
      } else if (event.type === 'session.status') {
        if (event.properties.status.type === 'idle') {
          deliverer.markIdle(event.properties.sessionID)
        } else {
          deliverer.markBusy(event.properties.sessionID)

          return
        }
      } else {
        return
      }

      await refreshServerUrls(event.properties.sessionID, String(serverUrl))
      await deliverer.drain()
    },
    tool: {
      pubsub_subscribe: tool({
        description:
          'Subscribe this session to a pubsub channel. New messages published to the channel by other sessions are delivered to this session automatically as tasks.',
        args: {
          channel: tool.schema.string().describe('Channel to subscribe to, referenced by number, e.g. "1"')
        },
        async execute(args, context) {
          if (!isChannel(args.channel)) {
            return channelHint(args.channel)
          }

          const result = await subscribe({
            sessionID: context.sessionID,
            channel: args.channel,
            serverUrl: String(serverUrl),
            directory: context.directory,
            createdAt: new Date().toISOString()
          })

          return result === 'created'
            ? `Subscribed to channel ${args.channel}. Messages published to this channel by other sessions will arrive here automatically as tasks.`
            : `Already subscribed to channel ${args.channel}.`
        }
      }),
      pubsub_unsubscribe: tool({
        description: 'Unsubscribe this session from a pubsub channel.',
        args: {
          channel: tool.schema.string().describe('Channel to unsubscribe from, referenced by number, e.g. "1"')
        },
        async execute(args, context) {
          if (!isChannel(args.channel)) {
            return channelHint(args.channel)
          }

          await unsubscribe(args.channel, context.sessionID)

          return `Unsubscribed from channel ${args.channel}.`
        }
      }),
      pubsub_publish: tool({
        description:
          'Publish a message to a pubsub channel. All sessions subscribed to the channel are woken automatically and receive the message as a task. If you expect a reply, follow up with pubsub_wait.',
        args: {
          channel: tool.schema.string().describe('Channel to publish to, referenced by number, e.g. "1"'),
          message: tool.schema
            .string()
            .max(16_000)
            .describe('The message to publish, phrased as a task for the receiving session, up to 16k characters')
        },
        async execute(args, context) {
          if (!isChannel(args.channel)) {
            return channelHint(args.channel)
          }

          const seq = await publish(args.channel, {
            text: args.message,
            from: context.sessionID,
            directory: context.directory
          })
          deliverer.sweep()

          return `Published message #${seq} to channel ${args.channel}. Subscribers are woken automatically. Call pubsub_wait with channel ${args.channel} and afterSeq ${seq} to block until a reply arrives.`
        }
      }),
      pubsub_wait: tool({
        description:
          'Block until a new message arrives on a pubsub channel and return it. Use this after pubsub_publish to wait for a reply instead of polling with shell commands. Messages from your own session are ignored.',
        args: {
          channel: tool.schema.string().describe('Channel to wait on, referenced by number, e.g. "1"'),
          afterSeq: tool.schema
            .number()
            .optional()
            .describe(
              'Only count messages with a higher sequence number, e.g. the message id returned by your pubsub_publish. Defaults to the latest message on the channel.'
            ),
          timeoutSeconds: tool.schema
            .number()
            .optional()
            .describe('How long to wait for a reply before giving up. Defaults to 120, capped at 600.')
        },
        async execute(args, context) {
          if (!isChannel(args.channel)) {
            return channelHint(args.channel)
          }

          const timeoutMs = Math.min(Math.max((args.timeoutSeconds ?? 120) * 1000, 1000), 600_000)
          let afterSeq = args.afterSeq
          afterSeq ??= await highestSeq(args.channel)

          const result = await waitForMessage({
            channel: args.channel,
            afterSeq,
            from: context.sessionID,
            timeoutMs
          })
          if (result.message === null) {
            return `Timed out after ${Math.round(timeoutMs / 1000)}s waiting on channel ${args.channel}: no new messages arrived after #${afterSeq}.`
          }

          const pending = result.pending > 0 ? ` ${result.pending} more message(s) are pending on this channel.` : ''

          return `Reply received on channel ${args.channel}: message #${result.message.seq} from session ${result.message.from}: ${result.message.text}${pending}`
        }
      })
    },
    config: async config => {
      await Promise.resolve()

      config.command = {
        ...config.command,
        listen: {
          description: 'Subscribe this session to a pubsub channel (usage: /listen 1)',
          template:
            'Call the pubsub_subscribe tool with channel set to the channel number from the arguments ($ARGUMENTS). If no channel number was given, ask for one instead. Then confirm the subscription in one short sentence and note that new messages on this channel will arrive automatically as tasks.'
        },
        publish: {
          description: 'Publish a message to a pubsub channel (usage: /publish 1 fix the login bug)',
          template:
            'Interpret the arguments ($ARGUMENTS) as "<channel> <message>". Call the pubsub_publish tool with channel set to the first word and message set to the remaining text. Then confirm what was published in one short sentence.'
        }
      }
    }
  }
}
