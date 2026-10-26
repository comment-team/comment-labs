/**
 * V2 adapter (OpenCode 2) for loop-guard.
 */
import { Plugin } from '@opencode/plugin'
import { LoopTracker, type LoopGuardOptions } from './core'


function readGuardOptions(value: unknown): LoopGuardOptions {
  if (typeof value !== 'object' || value === null) {
    return {}
  }

  const options: LoopGuardOptions = {}
  if ('disabled' in value && typeof value.disabled === 'boolean') {
    options.disabled = value.disabled
  }

  if ('threshold' in value && typeof value.threshold === 'number') {
    options.threshold = value.threshold
  }

  return options
}

export const v2def = () =>
  Plugin.define({
    id: 'loop-guard',
    async setup(ctx) {
      const options = readGuardOptions(ctx.options)
      if (options.disabled === true) {
        return
      }

      const tracker = new LoopTracker(options)
      await ctx.tool.hook('execute.before', event => {
        const hit = tracker.observe(event.sessionID, event.tool, event.input)
        if (hit !== undefined) {
          throw new Error(hit)
        }
      })
    }
  })
