/**
 * V2 adapter (OpenCode 2): Plugin.define with domain hooks and a tool
 * transform. The transform replaces the builtin grep tool with the
 * tgrep-backed one and appends the guard rules to the bash description.
 */
import { Plugin } from '@opencode/plugin'
import process from 'node:process'
import {
  BASH_GUIDE,
  GREP_JSON_SCHEMA,
  GREP_TOOL_DESCRIPTION,
  guardCommand,
  grepSearch,
  type GuardOptions,
  type GrepInput
} from './core'


function readGuardOptions(value: unknown): GuardOptions {
  if (typeof value !== 'object' || value === null) {
    return {}
  }

  const options: GuardOptions = {}
  if ('disabled' in value && typeof value.disabled === 'boolean') {
    options.disabled = value.disabled
  }

  if ('gitLogLimit' in value && typeof value.gitLogLimit === 'number') {
    options.gitLogLimit = value.gitLogLimit
  }

  return options
}

function hasCommand(input: unknown): input is { command: unknown } {
  return typeof input === 'object' && input !== null && 'command' in input
}

function isGrepInput(input: unknown): input is GrepInput {
  return typeof input === 'object' && input !== null && 'pattern' in input && typeof input.pattern === 'string'
}

function sessionDirectory(session: unknown): string {
  if (typeof session === 'object' && session !== null && 'directory' in session && typeof session.directory === 'string') {
    return session.directory
  }

  return process.cwd()
}

export const v2def = () =>
  Plugin.define({
    id: 'unbash-guard',
    async setup(ctx) {
      const options = readGuardOptions(ctx.options)
      if (options.disabled === true) {
        return
      }

      await ctx.tool.hook('execute.before', event => {
        if (event.tool !== 'bash' && event.tool !== 'shell') {
          return
        }

        if (!hasCommand(event.input)) {
          return
        }

        const cmd = event.input.command
        if (typeof cmd !== 'string') {
          return
        }

        const r = guardCommand(cmd, options)
        if (r.blocked !== undefined) {
          throw new Error(r.blocked)
        }

        if (r.command !== cmd) {
          event.input.command = r.command
        }
      })
      await ctx.tool.transform(editor => {
        // session directory cache — V2 tool contexts have no cwd; resolve it
        // from the session record
        const dirs = new Map<string, Promise<string>>()
        const dirFor = async (sessionID: string): Promise<string> => {
          let p = dirs.get(sessionID)
          if (!p) {
            p = ctx.session
              .get({ sessionID })
              .then(sessionDirectory)
              .catch(() => process.cwd())
            dirs.set(sessionID, p)
          }

          return await p
        }

        editor.add({
          name: 'grep',
          description: GREP_TOOL_DESCRIPTION,
          input: GREP_JSON_SCHEMA,
          async execute(input, context) {
            if (!isGrepInput(input)) {
              throw new Error('invalid grep tool input: pattern must be a string')
            }

            const r = await grepSearch(input, { base: await dirFor(context.sessionID), signal: context.signal })

            return { content: r.output }
          }
        })
        editor.update('bash', t => {
          if (t.description && !t.description.includes('unbash-guard')) {
            t.description += BASH_GUIDE
          } else if (!t.description) {
            t.description = BASH_GUIDE.trimStart()
          }
        })
      })
    }
  })
