/**
 * comment-labs opencode-lane — OpenCode 2 plugin.
 *
 * Built artifact: dist/index.mjs, produced by tsdown (pnpm build). Local dev
 * loads this source directly via the loader file in
 * ~/.config/opencode/plugins/comment-labs-lane.ts (opencode auto-discovers
 * direct .ts files there, while configured `plugins` array paths must be
 * directories — so the repo deliberately ships no root entry file). Once
 * this package is published, opencode configs reference
 * "@comment-labs/opencode-lane" directly. Pure logic lives in ./core
 * (tests import it directly).
 *
 * Three jobs:
 * 1. lane as the worktree strategy: opencode's worktree create/remove/list
 * route through the lane CLI, so every tree opencode creates is a
 * copy-on-write clone with warm caches (https://lane.lukeed.com).
 * 2. lane-guard: bash `git worktree <add|remove|move|lock|unlock|repair>`
 * is blocked, the same way unbash-guard blocks file reads — agents use
 * `lane new` / `lane rm` instead. `git worktree list` (read-only) and
 * `git worktree prune` (registry hygiene) stay allowed.
 * 3. lane tools: agent-facing lane_create / lane_list / lane_switch tools.
 * lane_switch moves the session working directory exactly like the /cd
 * command does internally (session.move), and refuses to switch until
 * the user has approved the target through a `question` tool answer in
 * this session — the only interactive approval channel a plugin tool
 * has (plugins cannot create permission requests themselves).
 *
 * Options (object form in the plugins config):
 * disabled: true — turn the plugin off
 * lanePath: "/path/lane" — override the lane binary location
 */
import { Plugin } from '@opencode/plugin'
import { execFile, type ExecFileOptions } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import {
  approvalFor,
  BASH_GUIDE,
  guardCommand,
  LANE_NAME_RE,
  parseLanePorcelain,
  resolveLane,
  type LaneEntry
} from './core'

type LaneOptions = { disabled?: boolean; lanePath?: string }

// tsgolint resolves the overloaded execFile signature against promisify's
// void-callback parameter type and misfires; tsc picks the proper overload
// oxlint-disable-next-line typescript/strict-void-return
const execFileAsync = promisify(execFile)

const run = async (file: string, args: string[], opts: ExecFileOptions): Promise<string> => {
  const { stdout } = await execFileAsync(file, args, { ...opts, encoding: 'utf8' })

  return stdout
}

/** A bare `# AGENTS` heading: all that lane init would have left behind. */
const AGENTS_TITLE_RE = /^#\s*AGENTS\s*$/iu

/**
 * Main checkout root of any directory inside a repository (works from
 * worktrees too — git-common-dir always points at the canonical .git).
 */
const mainRoot = async (dir: string, signal: AbortSignal | undefined) => {
  const out = await run('git', [ 'rev-parse', '--git-common-dir' ], { cwd: dir, signal })
  const common = out.trim()

  return resolve(dir, common === '.git' ? '.' : dirname(common))
}

/**
 * lane init on first use in a repo, stripping the AGENTS.md protocol block
 * lane appends (the global ~/.config/opencode/AGENTS.md carries the protocol
 * and .lane/ is globally gitignored — zero-git-footprint setup).
 */
async function ensureLaneInit(root: string, signal: AbortSignal | undefined, lane: string) {
  if (existsSync(join(root, '.lane'))) {
    return
  }

  const agentsPath = join(root, 'AGENTS.md')
  const before = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : undefined
  await run(lane, [ 'init' ], { cwd: root, signal })
  if (existsSync(agentsPath)) {
    const after = readFileSync(agentsPath, 'utf8')
    const stripped = after.replaceAll(/[\t ]*<!-- lane:protocol -->[\s\S]*?<!-- \/lane:protocol -->[\t ]*\n?/gu, '')
    if (stripped !== after) {
      const bare = stripped.trim()
      if (before === undefined && (bare === '' || AGENTS_TITLE_RE.test(bare))) {
        unlinkSync(agentsPath)
      } else if (before !== undefined && stripped.trim() === before.trim()) {
        writeFileSync(agentsPath, before)
      } else {
        writeFileSync(agentsPath, stripped)
      }
    }
  }
}

async function createLane(root: string, name: string, signal: AbortSignal | undefined, lane: string) {
  await ensureLaneInit(root, signal, lane)
  await run(lane, [ 'new', name ], { cwd: root, signal })

  return join(root, '.lane', 'trees', name)
}

/**
 * All lanes of a repo, via `git worktree list --porcelain` filtered to the
 * `.lane/trees/` prefix — same discovery as the worktree strategy.
 */
async function laneEntries(root: string, signal: AbortSignal | undefined): Promise<LaneEntry[]> {
  if (!existsSync(join(root, '.lane'))) {
    return []
  }

  const out = await run('git', [ 'worktree', 'list', '--porcelain' ], { cwd: root, signal })

  return parseLanePorcelain(out, root)
}

const HEALTH_TOOL_DESCRIPTION = 'Lane plugin status — reports the lane binary (version, path), whether the lane worktree strategy registered, and whether the bash guard is active. Use this whenever the user asks about lane integration state or before debugging worktree creation.'

const HEALTH_SCHEMA = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false
} as const

// ---------------------------------------------------------------------------
// lane tools
// ---------------------------------------------------------------------------

const CREATE_DESCRIPTION = 'Create a new lane worktree (copy-on-write clone of the repository\'s main checkout at HEAD, warm caches) and return its directory. The session is NOT moved — ask the user and use lane_switch to work inside it. Returns an error if the name is already taken.'

const CREATE_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, description: 'Lane name: lowercase kebab-case (a-z, 0-9, hyphens), e.g. \'fix-login-bug\'.' }
  },
  required: [ 'name' ],
  additionalProperties: false
} as const

const LIST_DESCRIPTION = 'List the lane worktrees of the session\'s repository: each lane\'s name, directory and branch, plus the main checkout. Read-only.'

const LIST_SCHEMA = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false
} as const

const SWITCH_DESCRIPTION = 'Switch the session\'s working directory to a lane worktree — the exact internal mechanism of the /cd command. REQUIRES USER APPROVAL: this tool refuses to switch until the user has approved the target in this session, so FIRST ask with the question tool ("Switch to lane \'<name>\' at <directory>?" with options like Approve / Reject), then call lane_switch. Refused or unanswered switches return an error — never retry without asking.'

const SWITCH_SCHEMA = {
  type: 'object',
  properties: {
    lane: { type: 'string', minLength: 1, description: 'Lane name as shown by lane_list (or its full directory path).' }
  },
  required: [ 'lane' ],
  additionalProperties: false
} as const

export default Plugin.define({
  id: 'opencode-lane',
  async setup(ctx) {
    const options = ctx.options as LaneOptions
    if (options.disabled === true) {
      return
    }

    const lane = options.lanePath ?? join(process.env.HOME ?? '', '.local', 'bin', 'lane')
    let strategyActive = false
    let strategyError: string | undefined

    // lane-guard: block raw `git worktree` lifecycle commands in bash
    await ctx.tool.hook('execute.before', event => {
      if (event.tool !== 'bash' && event.tool !== 'shell') {
        return
      }

      const input = event.input
      if (typeof input === 'object' && input !== null && 'command' in input && typeof input.command === 'string') {
        const r = guardCommand(input.command)

        if (r?.blocked !== undefined) {
          throw new Error(r.blocked)
        }
      }
    })
    await ctx.tool.transform(editor => {
      editor.update('bash', t => {
        if (!t.description.includes('lane-guard')) {
          if (t.description === '') {
            t.description = BASH_GUIDE.trimStart()
          } else {
            t.description += BASH_GUIDE
          }
        }
      })
      editor.add({
        name: 'lane-health',
        description: HEALTH_TOOL_DESCRIPTION,
        input: HEALTH_SCHEMA,
        async execute() {
          const lines: string[] = []

          try {
            const version = (await run(lane, [ '--version' ], { timeout: 10_000 })).trim()
            lines.push(`lane binary: ${version} (${lane})`)
          } catch (error) {
            lines.push(`lane binary: MISSING at ${lane} — ${error instanceof Error ? error.message : String(error)}`)
          }

          lines.push(`strategy: ${strategyActive ? 'registered (opencode worktree create/remove/list route through lane)' : 'NOT registered'}`)
          if (strategyError !== undefined) {
            lines.push(`strategy error: ${strategyError}`)
          }

          lines.push('guard: active — git worktree add/remove/move/lock/unlock/repair are blocked in bash')

          return { content: lines.join('\n') }
        }
      })

      // lane_create / lane_list / lane_switch — anchored on the session's
      // current directory, not the plugin's load location.
      editor.add({
        name: 'lane_create',
        description: CREATE_DESCRIPTION,
        input: CREATE_SCHEMA,
        options: { permission: 'lane_create' },
        async execute(input, context) {
          const rawName = typeof input === 'object' && input !== null && 'name' in input ? input.name : undefined
          const name = typeof rawName === 'string' ? rawName.trim().toLowerCase() : ''
          if (!LANE_NAME_RE.test(name)) {
            throw new Error(`Invalid lane name "${String(rawName)}" — use lowercase kebab-case (a-z, 0-9, hyphens), e.g. "fix-login-bug".`)
          }

          const session = await ctx.session.get({ sessionID: context.sessionID })
          const root = await mainRoot(session.location.directory, context.signal)
          if (existsSync(join(root, '.lane', 'trees', name))) {
            throw new Error(`Lane "${name}" already exists at ${join(root, '.lane', 'trees', name)} — use lane_switch to work there.`)
          }

          const directory = await createLane(root, name, context.signal, lane)

          return {
            content: `Created lane "${name}" at ${directory} (copy-on-write clone of ${root} at HEAD, warm caches). The session was not moved — ask the user and use lane_switch to switch to it.`
          }
        }
      })
      editor.add({
        name: 'lane_list',
        description: LIST_DESCRIPTION,
        input: LIST_SCHEMA,
        options: { permission: 'lane_list' },
        async execute(_input, context) {
          const session = await ctx.session.get({ sessionID: context.sessionID })
          let entries: LaneEntry[]

          try {
            const root = await mainRoot(session.location.directory, context.signal)
            entries = await laneEntries(root, context.signal)
          } catch (error) {
            return { content: `No lanes: the session directory is not inside a git repository (${error instanceof Error ? error.message : String(error)}).` }
          }

          if (entries.length === 0) {
            return { content: 'No lane worktrees exist yet in this repository. Create one with lane_create (or `lane new <name>` in a terminal).' }
          }

          const current = resolve(session.location.directory)
          const lines = entries.map(entry => `- ${entry.name}${entry.directory === current ? ' (current)' : ''} — ${entry.directory}${entry.branch === undefined ? '' : ` (branch ${entry.branch})`}`)

          return { content: [ 'Lanes in this repository:', ...lines ].join('\n') }
        }
      })
      editor.add({
        name: 'lane_switch',
        description: SWITCH_DESCRIPTION,
        input: SWITCH_SCHEMA,
        options: { permission: 'lane_switch' },
        async execute(input, context) {
          const rawLane = typeof input === 'object' && input !== null && 'lane' in input ? input.lane : undefined
          const session = await ctx.session.get({ sessionID: context.sessionID })
          const current = resolve(session.location.directory)
          let root: string

          try {
            root = await mainRoot(current, context.signal)
          } catch (error) {
            throw new Error(`The session directory is not inside a git repository (${error instanceof Error ? error.message : String(error)}) — there is nothing to switch to.`, { cause: error })
          }

          const target = resolveLane(typeof rawLane === 'string' ? rawLane : '', root)
          if (target === undefined) {
            const known = (await laneEntries(root, context.signal)).map(e => e.name)

            throw new Error(`Unknown lane "${String(rawLane)}". Known lanes: ${known.length > 0 ? known.join(', ') : '(none — create one with lane_create)'}.`)
          }

          if (!existsSync(target.directory)) {
            throw new Error(`Lane "${target.name}" does not exist at ${target.directory}. Use lane_list and pick an existing lane, or lane_create first.`)
          }

          if (target.directory === current) {
            return { content: `Already in lane "${target.name}" (${current}) — nothing to switch.` }
          }

          // Hard approval gate: the user must have answered a question
          // tool call about this exact target in this session.
          const messages = await ctx.session.context({ sessionID: context.sessionID })
          const verdict = approvalFor(target.name, target.directory, messages)
          if (verdict !== 'approved') {
            const reason
              = verdict === 'rejected'
                ? `The user rejected switching to "${target.name}". Do not switch; ask what they want instead.`
                : `No user approval found for switching to "${target.name}". Ask with the question tool first — question: "Switch to lane '${target.name}' at ${target.directory}?" with options Approve / Reject — then call lane_switch again.`

            throw new Error(`lane_switch BLOCKED: ${reason}`)
          }

          // Same internal mechanism as the /cd command.
          await ctx.session.move({ sessionID: context.sessionID, directory: target.directory })

          return {
            content: `Switched the session working directory to lane "${target.name}" (${target.directory}) — same as /cd. Subsequent commands and file tools run there.`
          }
        }
      })
    })

    // lane as the worktree strategy: create/remove/discover via the lane CLI.
    // Fail-safe: on an opencode build whose runtime host lacks the worktree
    // domain, the guard above stays active and the strategy error is
    // reported via lane-health.
    try {
      await ctx.worktree.transform(editor => {
        editor.add({
          id: 'lane',
          async create(input, context) {
            if (input.branch !== undefined) {
              throw new Error(
                `lane strategy creates lanes from HEAD only — starting ref "${input.branch}" is unsupported; run \`lane new\` in a terminal for a custom base`
              )
            }

            const root = await mainRoot(input.sourceDirectory, context.signal)
            const name = basename(input.directory)
            if (!existsSync(join(root, '.lane', 'trees', name))) {
              await createLane(root, name, context.signal, lane)
            }

            return { directory: join(root, '.lane', 'trees', name) }
          },
          async remove(input, context) {
            const root = await mainRoot(input.directory, context.signal)
            const rmArgs = [ 'rm', basename(input.directory) ]
            if (input.force) {
              rmArgs.push('--force')
            }

            await run(lane, rmArgs, { cwd: root, signal: context.signal })
          },
          async list(sourceDirectory, context) {
            try {
              const root = await mainRoot(sourceDirectory, context.signal)
              const entries = await laneEntries(root, context.signal)

              return entries.map(entry => ({ directory: entry.directory, type: 'worktree' as const }))
            } catch {
              // not a git repository — nothing to discover
              return []
            }
          }
        })
      })
      strategyActive = true
    } catch (error) {
      strategyError = error instanceof Error ? error.message : String(error)
    }
  }
})
