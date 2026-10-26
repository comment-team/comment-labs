/**
 * Framework-agnostic core for opencode-lane: lane-guard command analysis,
 * lane name/resolution rules, the lane_switch approval scan, and lane
 * inventory parsing. No opencode imports — the plugin wiring in ./index runs
 * this same core, and tests import it directly.
 */
import { basename, join, resolve } from 'node:path'
import { parse } from 'unbash'

// --- unbash AST shapes (the subset this guard reads) ------------------------

/**
 * unbash suffix words are plain {text,...} objects with NO `type` field —
 * only wrapper nodes (Script/Statement/Command) carry one.
 */
const isWord = (n: unknown): n is { text: string; [k: string]: unknown } =>
  typeof n === 'object'
  && n !== null
  && 'text' in n
  && typeof n.text === 'string'
  && (!('type' in n) || n.type === undefined)

/**
 * The word text of a parsed unbash node, when it has one.
 */
const wordText = (v: unknown): string | undefined =>
  typeof v === 'object' && v !== null && 'text' in v && typeof v.text === 'string' ? v.text : undefined

// --- transcript shapes + narrowing helpers ---------------------------------

/**
 * opencode serializes `question` tool parts into the session transcript;
 * only these fields matter for the approval scan.
 */
type QuestionState = {
  status?: unknown
  input?: unknown
  metadata?: Record<string, unknown>
  content?: unknown
}
type ToolPart = { type?: unknown; name?: unknown; state?: QuestionState }
type TranscriptMessage = { content?: unknown }

const asRecord = (v: unknown): Record<string, unknown> => {
  if (typeof v !== 'object' || v === null) {
    return {}
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return v as Record<string, unknown>
}

const asState = (v: unknown): QuestionState | undefined => {
  if (typeof v !== 'object' || v === null) {
    return undefined
  }

  const n = asRecord(v)

  return { status: n.status, input: n.input, metadata: asRecord(n.metadata), content: n.content }
}

const asPart = (v: unknown): ToolPart => {
  const n = asRecord(v)

  return { type: n.type, name: n.name, state: asState(n.state) }
}

const asMessage = (v: unknown): TranscriptMessage => {
  const n = asRecord(v)

  return { content: n.content }
}

// --- lane-guard: block raw `git worktree` lifecycle commands ----------------

export const BLOCKED_SUBS = new Set([ 'add', 'remove', 'rm', 'move', 'lock', 'unlock', 'repair' ])

/**
 * Flags whose following word is a value, so `git -C worktree status` is not
 * misread as a worktree command.
 */
const VALUE_FLAGS = new Set([ '-C', '-c', '--git-dir', '--work-tree', '--exec-path', '--namespace', '--super-prefix' ])

export const WORKTREE_MSG = (sub: string) =>
  `lane-guard BLOCKED: \`git worktree ${sub}\` — worktrees are managed by lane, not raw git. Use \`lane new <name>\` (copy-on-write tree, warm caches) or \`lane rm <name>\` instead. Read-only \`git worktree list\` is allowed. opencode's own worktree creation already routes through lane.`

export const BASH_GUIDE = `
lane-guard rule (enforced): worktrees are managed by the lane CLI — \`git worktree add/remove/move/lock/unlock/repair\` is auto-rejected. Use \`lane new <name>\` and \`lane rm <name>\` (\`git worktree list\` and \`git worktree prune\` are allowed).`

/**
 * Detect a blocked `git worktree <sub>` anywhere in the command. Returns a
 * block message for the first hit, or undefined when the command is clean or
 * unparseable (unparseable commands are left alone).
 */
export function guardCommand(command: string): { blocked?: string } | undefined {
  try {
    const found: string[] = []
    const walk = (node: unknown) => {
      if (typeof node !== 'object' || node === null) {
        return
      }

      const n = asRecord(node)
      if (n.type === 'Command' && wordText(n.name) === 'git') {
        const suffix = Array.isArray(n.suffix) ? n.suffix : []
        const words = suffix.filter(w => isWord(w)).map(w => w.text)
        const valuePos = new Set<number>()

        for (const [ i, w ] of words.entries()) {
          if (VALUE_FLAGS.has(w)) {
            valuePos.add(i + 1)
          }
        }

        const at = words.indexOf('worktree')
        if (at !== -1 && !valuePos.has(at)) {
          const sub = words[at + 1] ?? ''
          if (BLOCKED_SUBS.has(sub)) {
            found.push(sub)
          }
        }
      }

      for (const value of Object.values(n)) {
        walk(value)
      }
    }

    walk(parse(command))

    const first = found[0]
    if (first !== undefined) {
      return { blocked: WORKTREE_MSG(first) }
    }
  } catch {
    // unparseable commands are left alone
  }

  return undefined
}

// --- lane names and resolution ----------------------------------------------

export const LANE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/u

export type LaneTarget = { name: string; directory: string }

/**
 * Resolve the lane a tool call asked for to { name, directory } under root.
 * Accepts a lane name, a repo-relative `.lane/trees/` path, or an absolute
 * trees path (which must stay under <root>/.lane/trees).
 */
export function resolveLane(input: string, root: string): LaneTarget | undefined {
  const value = input.trim()
  if (value === '') {
    return undefined
  }

  const treesDir = join(root, '.lane', 'trees')
  if (value.includes('/')) {
    const absolute = resolve(root, value)
    if (!absolute.startsWith(`${treesDir}/`)) {
      return undefined
    }

    const name = basename(absolute)
    if (!LANE_NAME_RE.test(name)) {
      return undefined
    }

    return { name, directory: absolute }
  }

  if (!LANE_NAME_RE.test(value)) {
    return undefined
  }

  return { name: value, directory: join(treesDir, value) }
}

// --- lane inventory ----------------------------------------------------------

export type LaneEntry = { name: string; directory: string; branch: string | undefined }

/**
 * Parse `git worktree list --porcelain` output into the lanes of a repo:
 * entries under `<root>/.lane/trees/`, main checkout excluded.
 */
export function parseLanePorcelain(out: string, root: string): LaneEntry[] {
  const prefix = `${join(root, '.lane', 'trees')}/`
  const entries: LaneEntry[] = []
  let directory: string | undefined
  let branch: string | undefined
  const flush = () => {
    if (directory?.startsWith(prefix) === true) {
      entries.push({ name: basename(directory), directory, branch })
    }

    directory = undefined
    branch = undefined
  }

  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush()
      directory = line.slice('worktree '.length)
    } else if (line.startsWith('branch refs/heads/')) {
      branch = line.slice('branch refs/heads/'.length)
    }
  }

  flush()

  return entries
}

// --- lane_switch approval gate ------------------------------------------------

/**
 * Words in a `question` tool answer that count as approval / rejection of a
 * switch. Checked against every answer string; a rejection match always wins
 * over an approval match.
 */
export const APPROVE_RE = /\b(?:approve[sd]?|confirmed?|yes|yeah|yep|ok|okay|proceed|go ahead|go for it|do it|sure|switch(?:ed| to)?)\b/iu
export const REJECT_RE
  = /\b(?:no|nope|nah|cancel(?:led|l)?|stop|reject(?:ed)?|refused?|denied|abort|do not|don'?t|keep|stay|not yet|not now|nevermind|never mind)\b/iu

/**
 * Extract the user's answers from a completed `question` tool part state.
 */
export const questionAnswers = (state: QuestionState): string[] => {
  const meta = state.metadata?.answers
  if (Array.isArray(meta)) {
    const flat = meta.flat().filter((a): a is string => typeof a === 'string' && a.length > 0)
    if (flat.length > 0) {
      return flat
    }
  }

  const content = Array.isArray(state.content) ? state.content : []
  const text = content.map((c: { type?: unknown; text?: unknown } | undefined | null) => (c?.type === 'text' && typeof c.text === 'string' ? c.text : '')).join('\n')
  // Fallback only: the question tool always records metadata.answers. The
  // raw content also contains the question wording, so never read an
  // approval out of text that looks like a question transcript.
  if (text.trim().length === 0 || text.includes('?')) {
    return []
  }

  return [ text ]
}

/**
 * True when the question text (question, header, option labels) names the
 * target lane, so the user actually saw what they approved.
 */
export const mentionsTarget = (input: unknown, name: string, directory: string): boolean => {
  const questions = asRecord(input).questions
  const blob = JSON.stringify(Array.isArray(questions) ? questions : [])
  if (blob.toLowerCase().includes(directory.toLowerCase())) {
    return true
  }

  try {
    // name comes from resolveLane and matches LANE_NAME_RE ([a-z0-9-]), so the
    // interpolated pattern cannot inject regex metacharacters
    // oxlint-disable-next-line security-js/detect-non-literal-regexp
    return new RegExp(`\\b${name.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)}\\b`, 'iu').test(blob)
  } catch {
    return false
  }
}

/**
 * Scan the session transcript (newest first) for a completed `question` tool
 * call about this exact target and return the user's verdict.
 */
export function approvalFor(
  name: string,
  directory: string,
  messages: readonly unknown[]
): 'approved' | 'rejected' | undefined {
  for (let m = messages.length - 1; m >= 0; m--) {
    const message = asMessage(messages[m])
    if (!Array.isArray(message.content)) {
      continue
    }

    for (let p = message.content.length - 1; p >= 0; p--) {
      const part = asPart(message.content[p])
      if (part.type !== 'tool' || part.name !== 'question') {
        continue
      }

      const state = part.state
      if (state === undefined || state.status !== 'completed') {
        continue
      }

      if (!mentionsTarget(state.input, name, directory)) {
        continue
      }

      const answers = questionAnswers(state)
      if (answers.length === 0) {
        return undefined
      }

      const joined = answers.join(' ')
      if (REJECT_RE.test(joined)) {
        return 'rejected'
      }

      if (APPROVE_RE.test(joined)) {
        return 'approved'
      }

      return undefined
    }
  }

  return undefined
}
