/**
 * V2 adapter (OpenCode 2) for hidden-guard.
 */
import { Plugin } from '@opencode/plugin'
import { argsTouchHidden, bashTouchesHidden, blockMessage, type HiddenGuardOptions } from './core'


function readGuardOptions(value: unknown): HiddenGuardOptions {
  if (typeof value !== 'object' || value === null) {
    return {}
  }

  const options: HiddenGuardOptions = {}
  if ('disabled' in value && typeof value.disabled === 'boolean') {
    options.disabled = value.disabled
  }

  if ('allow' in value && Array.isArray(value.allow)) {
    options.allow = value.allow.filter((item): item is string => typeof item === 'string')
  }

  return options
}

function hasCommand(input: unknown): input is { command: unknown } {
  return typeof input === 'object' && input !== null && 'command' in input
}

export const v2def = () =>
  Plugin.define({
    id: 'hidden-guard',
    async setup(ctx) {
      const options = readGuardOptions(ctx.options)
      if (options.disabled === true) {
        return
      }

      await ctx.tool.hook('execute.before', event => {
        if (event.tool === 'bash' || event.tool === 'shell') {
          const cmd = hasCommand(event.input) ? event.input.command : undefined
          if (typeof cmd === 'string') {
            const hit = bashTouchesHidden(cmd, options)
            if (hit !== undefined) {
              throw new Error(hit)
            }
          }

          return
        }

        const hit = argsTouchHidden(event.input, options)
        if (hit !== undefined) {
          throw new Error(blockMessage(hit))
        }
      })
    }
  })
