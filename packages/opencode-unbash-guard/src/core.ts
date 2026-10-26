/* oxlint-disable max-lines */
/**
 * Framework-agnostic core for opencode-unbash-guard: the bash command
 * analyzer/rewriter and the tgrep-backed search executor. No opencode
 * imports — the V2 adapter runs this core.
 */
import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import * as path from 'node:path'
import { parse } from 'unbash'

export type GuardOptions = {
  gitLogLimit?: number
  disabled?: boolean
  /** internal: blocks quiet rewrites when analyzing nested substitutions */
  noRewrite?: boolean
}

type Word = { text: string; pos: number; end: number; value?: string }
type Redirect = { operator?: string; target?: Word; pos: number; end: number }
type Node = {
  type?: string
  text?: string
  pos?: number
  end?: number
  commands?: Node[]
  command?: Node
  body?: Node
  clause?: Node
  then?: Node
  else?: Node
  wordlist?: Node[]
  name?: Word
  suffix?: Word[]
  prefix?: Word[]
  redirects?: Redirect[]
  operators?: string[]
  errors?: unknown[]
  [k: string]: unknown
}

const READERS = new Set([ 'cat', 'head', 'tail', 'nl', 'tac', 'bat' ])
const PAGERS = new Set([ 'less', 'more' ])
const GREPPERS = new Set([ 'grep', 'egrep', 'fgrep', 'rg', 'ripgrep', 'ggrep' ])
const APPEND_OPS = new Set([ '>', '>>', '>|', '&>', '&>>', '>!', '&>|' ])
const INPUT_OPS = new Set([ '<', '<&' ])
const NUMERIC_FLAG_REGEX = /^-\d+$/u
const VALUE_FLAGS: Record<string, Set<string>> = {
  head: new Set([ '-n', '-c' ]),
  tail: new Set([ '-n', '-c' ]),
  grep: new Set([ '-e', '-m', '-A', '-B', '-C', '--include', '--exclude', '--exclude-dir', '--max-count' ]),
  egrep: new Set([ '-e', '-m', '-A', '-B', '-C', '--include', '--exclude', '--exclude-dir', '--max-count' ]),
  fgrep: new Set([ '-e', '-m', '-A', '-B', '-C', '--include', '--exclude', '--exclude-dir', '--max-count' ]),
  rg: new Set([ '-e', '-g', '-t', '-T', '-A', '-B', '-C', '--glob', '--type', '--max-count' ]),
  ripgrep: new Set([ '-e', '-g', '-t', '-T', '-A', '-B', '-C', '--glob', '--type', '--max-count' ]),
  git: new Set([ '-C', '--git-dir', '--work-tree', '-c', '--namespace' ])
}

function isWord(n: unknown): n is Word {
  return typeof n === 'object'
    && n !== null
    && 'text' in n
    && typeof n.text === 'string'
    && !('type' in n && n.type !== undefined && n.type !== '')
}

function words(n: Node, key: 'suffix' | 'prefix'): Word[] {
  const v = n[key]

  return Array.isArray(v) ? v.filter(w => isWord(w)) : []
}

function positionalArgs(name: string, suffix: Word[], skipFirst = false): Word[] {
  const valueFlags = VALUE_FLAGS[name]
  const out: Word[] = []
  let skipNext = false
  let first = true

  for (const w of suffix) {
    if (skipNext) {
      skipNext = false
      continue
    }

    if (valueFlags?.has(w.text) === true) {
      skipNext = true
      continue
    }

    if (w.text === '--') {
      continue
    }

    if (w.text.startsWith('-') && w.text !== '-') {
      continue
    }

    if (first && skipFirst) {
      first = false
      continue
    }

    first = false
    out.push(w)
  }

  return out
}

function hasFlag(suffix: Word[], pred: (t: string) => boolean): boolean {
  return suffix.some(w => pred(w.text))
}

function redirectInfo(n: Node): { writes: boolean; appends: boolean; reads: boolean } {
  let writes = false
  let appends = false
  let reads = false

  for (const r of n.redirects ?? []) {
    const op = r.operator ?? ''
    if (r.target === undefined) {
      continue
    }

    if (APPEND_OPS.has(op)) {
      writes = true
      if (op === '>>' || op === '&>>') {
        appends = true
      }
    }

    if (INPUT_OPS.has(op)) {
      reads = true
    }
  }

  return { writes, appends, reads }
}

function quote(orig: string, n: Node): string {
  const s = typeof n.pos === 'number' && typeof n.end === 'number' ? orig.slice(n.pos, n.end) : 'command'

  return s.length > 120 ? `${s.slice(0, 117)}…` : s
}

const READ_MSG = (orig: string, n: Node) =>
  `unbash-guard BLOCKED: \`${quote(orig, n)}\` reads a file through bash. Use the read tool instead (filePath + offset/limit as needed). Piping command output through ${n.name?.text} is still allowed; only file reads are blocked.`

const WRITE_MSG = (orig: string, n: Node, appends: boolean) =>
  `unbash-guard BLOCKED: \`${quote(orig, n)}\` writes a file through bash. Use the ${appends ? 'edit tool (append) or write tool' : 'write tool'} instead.`

const SEDIT_MSG = (orig: string, n: Node) =>
  `unbash-guard BLOCKED: \`${quote(orig, n)}\` edits a file in place through bash. Use the edit tool instead.`

const GREP_MSG = (orig: string, n: Node) =>
  `unbash-guard BLOCKED: \`${quote(orig, n)}\` searches files with ${n.name?.text}. Use tgrep instead (it's installed): bash → tgrep -- <pattern> [path...] (add -g '<glob>' for include filters). Piping stdin into grep stays allowed; only file/directory search is blocked.`

const CHAIN_MSG = (op: string, orig: string) =>
  `unbash-guard BLOCKED: command combining with \`${op}\` (\`${orig.length > 100 ? `${orig.slice(0, 97)}…` : orig}\`). Run each command as its own separate bash call instead (use the workdir parameter rather than cd chains).`

type Analysis = { blocked?: string; splices: Array<[number, string]> }

function applyQuietRewrites(
  name: string,
  suffix: Word[],
  nameEnd: number,
  nodeEnd: number,
  out: Analysis,
  opts: GuardOptions
): void {
  if (name === 'git' && suffix.length > 0) {
    const sub = positionalArgs('git', suffix)[0]?.text
    // idempotency: the hook re-fires on retries and re-emitted args — skip
    // the global splice when this git command already carries it
    const alreadyQuiet = hasFlag(suffix, t => t === '--no-pager' || t.includes('color.ui'))
    if (!alreadyQuiet) {
      out.splices.push([ nameEnd, ' --no-pager -c color.ui=false' ])
    }

    if (sub === 'log') {
      const bounded = hasFlag(suffix, t => NUMERIC_FLAG_REGEX.test(t) || [ '-n', '--max-count' ].includes(t) || t.startsWith('--max-count='))
      if (!bounded) {
        out.splices.push([ nodeEnd, ` -n ${opts.gitLogLimit ?? 30}` ])
      }

      const oneline = hasFlag(suffix, t => t === '--oneline' || t.startsWith('--pretty') || t.startsWith('--format'))
      if (!oneline) {
        out.splices.push([ nodeEnd, ' --oneline' ])
      }
    } else if (sub === 'status') {
      const short = hasFlag(suffix, t => [ '-s', '-sb', '-b', '--short', '--porcelain', '--long' ].includes(t))
      if (!short) {
        out.splices.push([ nodeEnd, ' -sb' ])
      }
    }
  }

  if (name === 'npm') {
    const npmArgs = positionalArgs('npm', suffix)
    const sub = npmArgs[0]?.text ?? ''
    const bare = npmArgs.length === 1 && [ 'ls', 'list' ].includes(sub)
    if (bare && !hasFlag(suffix, t => t === '--depth' || t.startsWith('--depth='))) {
      out.splices.push([ nodeEnd, ' --depth=0' ])
    }
  }

  if (name === 'curl' && !hasFlag(suffix, t => [ '-s', '--silent', '-sS' ].includes(t))) {
    out.splices.push([ nodeEnd, ' -sS' ])
  }
}

function analyzeCommand(node: Node, ctx: { stdinPipe: boolean }, out: Analysis, opts: GuardOptions, orig: string) {
  if (node.type !== 'Command' || !isWord(node.name)) {
    return
  }

  const name = node.name.text
  const nodeEnd = node.end ?? node.name.end
  const suffix = words(node, 'suffix')
  const { writes, appends, reads } = redirectInfo(node)

  if (opts.noRewrite !== true) {
    applyQuietRewrites(name, suffix, node.name.end, nodeEnd, out, opts)
  }

  if (PAGERS.has(name)) {
    out.blocked ??= `unbash-guard BLOCKED: \`${quote(orig, node)}\` — pagers (${name}) are useless in a captured shell and bypass the read tool. Use the read tool instead.`

    return
  }

  if (name === 'sed') {
    if (hasFlag(suffix, t => t === '-i' || t === '--in-place' || t.startsWith('--in-place='))) {
      out.blocked ??= SEDIT_MSG(orig, node)

      return
    }

    if (reads || positionalArgs('sed', suffix, true).length > 0) {
      out.blocked ??= READ_MSG(orig, node)

      return
    }

    return
  }

  if (READERS.has(name)) {
    if (writes) {
      out.blocked ??= WRITE_MSG(orig, node, appends)

      return
    }

    if (reads || positionalArgs(name, suffix).length > 0) {
      out.blocked ??= READ_MSG(orig, node)

      return
    }

    return
  }

  if (name === 'echo' || name === 'printf') {
    if (writes) {
      out.blocked ??= WRITE_MSG(orig, node, appends)

      return
    }

    return
  }

  if (ctx.stdinPipe) {
    return
  }

  if (GREPPERS.has(name)) {
    if (hasFlag(suffix, t => t === '--files')) {
      return
    }

    const targets = positionalArgs(name, suffix).slice(1)
    const recursiveFlags = hasFlag(suffix, t => [ '-r', '-R', '--recursive' ].includes(t))
    const recursive = recursiveFlags || [ 'rg', 'ripgrep' ].includes(name)
    if (recursive || targets.length > 0) {
      out.blocked ??= GREP_MSG(orig, node)
    }
  }
}

function walk(
  node: unknown,
  ctx: { stdinPipe: boolean; top: boolean },
  out: Analysis,
  opts: GuardOptions,
  orig: string,
  depth = 0
) {
  if (node === null || node === undefined || typeof node !== 'object' || depth > 32 || out.blocked !== undefined) {
    return
  }

  if (Array.isArray(node)) {
    for (const n of node) {
      walk(n, ctx, out, opts, orig, depth + 1)
    }

    return
  }

  // parser AST boundary: every value reaching here comes from unbash's parse()
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const n = node as Node
  if (isWord(n)) {
    return
  }

  switch (n.type ?? '') {
    case 'Script':
    case 'CompoundList':
      if (ctx.top && (n.commands?.length ?? 0) > 1) {
        out.blocked ??= CHAIN_MSG(';', orig)
      }

      for (const s of n.commands ?? []) {
        walk(s, { ...ctx, top: false }, out, opts, orig, depth + 1)
      }

      return
    case 'AndOr':
      out.blocked ??= CHAIN_MSG(n.operators?.[0] ?? '&&', orig)

      return
    case 'Pipeline': {
      const cmds = n.commands ?? []
      cmds.forEach((c, i) => walk(c, { ...ctx, stdinPipe: i > 0, top: false }, out, opts, orig, depth + 1))

      return
    }

    case 'Subshell':
      walk(n.body, { ...ctx, top: true }, out, opts, orig, depth + 1)

      return
    case 'Command':
      analyzeCommand(n, ctx, out, opts, orig)

      return
    default:
      for (const k of [ 'command', 'body', 'clause', 'then', 'else', 'wordlist', 'commands', 'script', 'pattern', 'iterable', 'array' ]) {
        const v = (n as Record<string, unknown>)[k]
        if (v !== null && v !== undefined) {
          walk(v, { ...ctx, top: false }, out, opts, orig, depth + 1)
        }
      }
  }
}

function substitutions(src: string): string[] {
  const out: string[] = []
  let i = 0
  let quoteChar: '"' | '\'' | null = null

  while (i < src.length) {
    const c = src[i]
    if (quoteChar === '\'') {
      if (c === '\'') {
        quoteChar = null
      }

      i++
      continue
    }

    if (c === '\\') {
      i += 2
      continue
    }

    if (c === '"' || c === '\'') {
      quoteChar = c
      i++
      continue
    }

    const two = src.slice(i, i + 2)
    const opener = two === '$(' || c === '`' || two === '<('
    if (opener) {
      const start = i + (two === '$(' || two === '<(' ? 2 : 1)
      if (src.slice(start, start + 1) === '(') {
        i = start + 1
        continue
      }

      let depth = 1
      let j = start
      let q2: string | null = null

      while (j < src.length && depth > 0) {
        const d = src[j]
        if (d === undefined) {
          break
        }

        if (q2 === null) {
          switch (d) {
            case '"':
            case '\'':
              q2 = d

              break
            case '(':
              depth++

              break
            case ')':
              depth--

              break
            default:
              if (d === '`' || src.slice(j, j + 2) === '$(') {
                depth++
              }
          }
        } else if (d === q2) {
          q2 = null
        }

        j++
      }

      const inner = src.slice(start, depth === 0 ? j - 1 : j)
      if (inner.trim()) {
        out.push(inner)
      }

      i = j
      continue
    }

    i++
  }

  return out
}

export function guardCommand(command: string, opts: GuardOptions = {}): { blocked?: string; command: string } {
  if (opts.disabled === true) {
    return { command }
  }

  let ast: Node

  try {
    // unbash's own AST types are stricter unions; this loose Node is the
    // analyzer's working shape
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    ast = parse(command) as unknown as Node
  } catch {
    return { command }
  }

  const out: Analysis = { splices: [] }
  walk(ast, { stdinPipe: false, top: true }, out, opts, command)
  if (out.blocked !== undefined) {
    return { blocked: out.blocked, command }
  }

  for (const snippet of substitutions(command)) {
    const r = guardCommand(snippet, { ...opts, noRewrite: true })
    if (r.blocked !== undefined) {
      return { blocked: r.blocked, command }
    }
  }

  if (out.splices.length === 0) {
    return { command }
  }

  if (ast.errors !== undefined && ast.errors.length > 0) {
    return { command }
  }

  let src = command
  const sorted = out.splices.toSorted((a, b) => b[0] - a[0])

  for (const [ pos, text ] of sorted) {
    src = src.slice(0, pos) + text + src.slice(pos)
  }

  return { command: src }
}

export const GREP_TOOL_DESCRIPTION = `- Fast content search backed by tgrep (trigram-indexed grep, works with any codebase size)
- Searches file contents using regular expressions
- Supports full regex syntax (eg. "log.*Error", "function\\s+\\w+", etc.)
- Filter files by pattern with the include parameter (eg. "*.js", "*.{ts,tsx}")
- Returns file paths and line numbers with matching lines
- In git repos a trigram index is built/refreshed automatically (when >1h old), making searches very fast; outside git repos the search walks the tree
- If you need to identify/count the number of matches within files, use the Bash tool with \`tgrep --count\` instead
- Use this tool INSTEAD of running grep/rg in bash — bash grep is blocked by unbash-guard`

export const GREP_GUIDE = 'Powered by tgrep (trigram-indexed grep): index auto-built in git repos; consider `tgrep serve .` for a persistent in-RAM server.'

export const BASH_GUIDE = `

unbash-guard rules (enforced, violations are auto-rejected):
- File reads: use the read tool, never cat/head/tail/sed on files. Piping command output through them is fine.
- File writes: use the write/edit tools, never echo/printf/cat with > or >> redirects. sed -i is banned.
- Content search: use tgrep (bash: tgrep -- <pattern> [path...]), never grep or rg — or better, the grep tool.
- One command per call: no "a && b", "a || b", or "a; b" chains.`

export const GREP_JSON_SCHEMA = {
  type: 'object',
  properties: {
    pattern: { type: 'string', description: 'The regex pattern to search for in file contents' },
    path: { type: 'string', description: 'The directory or file to search in. Defaults to the current working directory.' },
    include: { type: 'string', description: 'File pattern to include in the search (eg. "*.js", "*.{ts,tsx}")' }
  },
  required: [ 'pattern' ],
  additionalProperties: false
} as const

const MATCH_LIMIT = 100
const INDEX_MAX_AGE_MS = 3_600_000
const TRAILING_NEWLINE_REGEX = /\r?\n$/u

function isTgrepMatch(
  value: unknown
): value is { type: string; data: { line_number: number; path?: { text?: string }; lines?: { text?: string } } } {
  if (typeof value !== 'object' || value === null || !('type' in value) || !('data' in value)) {
    return false
  }

  const data = value.data
  if (typeof data !== 'object' || data === null || !('line_number' in data) || typeof data.line_number !== 'number') {
    return false
  }

  return value.type === 'match'
}

function findGitRoot(from: string): string | undefined {
  let dir = path.resolve(from)

  for (let i = 0; i < 32; i++) {
    if (existsSync(path.join(dir, '.git'))) {
      return dir
    }

    const parent = path.dirname(dir)
    if (parent === dir) {
      return undefined
    }

    dir = parent
  }

  return undefined
}

async function runTgrep(
  args: string[],
  opts: { cwd: string; timeout: number; signal?: AbortSignal }
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  // oxlint-disable-next-line promise/avoid-new -- execFile reports exit status only through its callback error; the Promise wrapper is required
  return await new Promise((resolve, reject) => {
    execFile('tgrep', args, { cwd: opts.cwd, timeout: opts.timeout, signal: opts.signal, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err !== null && typeof err.code !== 'number') {
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- execFile's callback error type carries the exit code
        reject(err)

        return
      }

      resolve({ stdout, stderr, code: typeof err?.code === 'number' ? err.code : 0 })
    })
  })
}

export type GrepInput = { pattern: string; path?: string; include?: string }

async function refreshTgrepIndex(root: string, signal: AbortSignal | undefined): Promise<boolean> {
  const idx = path.join(root, '.tgrep')

  try {
    const stale = !existsSync(idx) || statSync(idx).mtimeMs < Date.now() - INDEX_MAX_AGE_MS
    if (stale) {
      await runTgrep([ 'index', root ], { cwd: root, timeout: 180_000, signal })

      return true
    }
  } catch {
    // indexing is best-effort; the search below falls back to scanning
  }

  return false
}

function parseMatches(stdout: string, cwd: string): Array<{ file: string; line: number; text: string }> {
  const rows: Array<{ file: string; line: number; text: string }> = []

  for (const line of stdout.split('\n')) {
    if (!line.trim()) {
      continue
    }

    let parsed: unknown

    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }

    if (!isTgrepMatch(parsed)) {
      continue
    }

    rows.push({
      file: path.resolve(cwd, parsed.data.path?.text ?? ''),
      line: parsed.data.line_number,
      text: (parsed.data.lines?.text ?? '').replace(TRAILING_NEWLINE_REGEX, '')
    })
  }

  return rows
}

function formatMatches(rows: Array<{ file: string; line: number; text: string }>, truncated: boolean): string {
  const output: string[] = [ `Found ${rows.length} matches${truncated ? ' (more matches available)' : ''}` ]
  let current = ''

  for (const m of rows) {
    if (current !== m.file) {
      if (current !== '') {
        output.push('')
      }

      current = m.file
      output.push(`${m.file}:`)
    }

    output.push(`  Line ${m.line}: ${m.text}`)
  }

  if (truncated) {
    output.push('', '(Results truncated. Consider using a more specific path or pattern.)')
  }

  return output.join('\n')
}

export async function grepSearch(
  args: GrepInput,
  ctx: { base: string; signal?: AbortSignal }
): Promise<{ output: string; metadata: Record<string, unknown> }> {
  if (args.pattern === '') {
    return { output: 'pattern is required', metadata: {} }
  }

  const requested = path.resolve(ctx.base, args.path ?? '.')
  let isDir: boolean

  try {
    isDir = statSync(requested).isDirectory()
  } catch {
    return { output: `Path not found: ${requested}`, metadata: {} }
  }

  const cwd = isDir ? requested : path.dirname(requested)
  const target = isDir ? '.' : path.basename(requested)
  const root = findGitRoot(cwd)

  let indexed = false
  if (root !== undefined) {
    indexed = await refreshTgrepIndex(root, ctx.signal)
  }

  const targs = [ '--json' ]
  if (args.include !== undefined) {
    targs.push('-g', args.include)
  }

  if (root !== undefined && isDir) {
    targs.push('--index-path', path.join(root, '.tgrep'))
  }

  targs.push('--', args.pattern, target)

  let res: { stdout: string; stderr: string; code: number | null }

  try {
    res = await runTgrep(targs, { cwd, timeout: 120_000, signal: ctx.signal })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)

    throw new Error(`tgrep search failed: ${msg}. If the tree is large and unindexed, try \`tgrep index\` first or narrow the path.`, { cause: error })
  }

  if (res.code !== null && res.code > 1) {
    throw new Error(`tgrep exited with code ${res.code}: ${res.stderr.trim().slice(0, 500)}`)
  }

  const rows = parseMatches(res.stdout, cwd)
  const meta: Record<string, unknown> = { matches: 0, truncated: false, ...(indexed && { indexed: true }) }

  if (rows.length === 0) {
    return { output: 'No files found', metadata: meta }
  }

  const truncated = rows.length > MATCH_LIMIT
  const shown = truncated ? rows.slice(0, MATCH_LIMIT) : rows

  return {
    output: formatMatches(shown, truncated),
    metadata: { ...meta, matches: shown.length, truncated }
  }
}
