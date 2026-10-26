/**
 * hidden-guard core: dotfile-read detection for tool args and bash
 * commands. Framework-agnostic — the V2 adapter runs this core.
 */
import { parse } from 'unbash'

export type HiddenGuardOptions = {
  /** dotfile basenames that are allowed to be read (eg. ['.bashrc']) */
  allow?: string[]
  disabled?: boolean
}

type Node = {
  type?: string
  text?: string
  name?: { text?: string }
  suffix?: unknown[]
  commands?: Node[]
  command?: Node
  body?: Node
  clause?: Node
  then?: Node
  else?: Node
  wordlist?: Node[]
  [k: string]: unknown
}

type Word = { text: string; pos?: number; end?: number; value?: string }

const PATH_SEGMENT_SPLIT_REGEX = /[\\/]/u
const PATH_ISH_REGEX = /^[.~/]/u
const URL_REGEX = /:\/\//u

function isWord(n: unknown): n is Word {
  return typeof n === 'object'
    && n !== null
    && 'text' in n
    && typeof n.text === 'string'
    && !('type' in n && n.type !== undefined && n.type !== '')
}

/**
 * Dotfile DIRECTORIES that are infrastructure, not secrets — allowed as
 * any path segment (.config, .git, build caches …).
 */
const INFRA_SEGMENTS = new Set([
  '.config', '.local', '.cache', '.git', '.github', '.gitlab', '.husky',
  '.opencode', '.codemode', '.tgrep', '.turbo', '.next', '.nuxt',
  '.svelte-kit', '.astro', '.output', '.pnpm-store', '.venv', '.venvs',
  '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache', '.idea', '.vscode',
  '.devcontainer', '.storybook', '.vercel', '.wrangler', '.claude',
  '.codesandbox', '.parcel-cache', '.yarn', '.expo', '.docusaurus'
])

/**
 * Dotfile NAMES that are code/config, not secrets — allowed as leaves.
 */
const INFRA_FILES = new Set([
  '.gitignore', '.gitattributes', '.gitmodules', '.gitkeep', '.editorconfig',
  '.prettierrc', '.eslintrc', '.oxlintrc.json', '.dockerignore', '.npmignore',
  '.nvmrc', '.node-version', '.tool-versions', '.python-version', '.DS_Store',
  '.babelrc', '.lintstagedrc', '.czrc', '.watchmanconfig', '.hgignore',
  '.flake8', '.pylintrc', '.prettierignore', '.eslintignore', '.stylelintrc',
  '.commitlintrc', '.releaserc', '.versionrc', '.taplo.toml', '.latexmkrc'
])

/**
 * Command flags whose VALUE is an expression — a jq filter, Go template,
 * or JMESPath — never a file path. The word after one of these is not a
 * file argument (gh --jq .headSha, aws --query '.Tags[0].Value' …).
 */
const EXPR_VALUE_FLAGS: Record<string, Set<string>> = {
  gh: new Set([ '--jq', '--template', '-t' ]),
  aws: new Set([ '--query' ]),
  az: new Set([ '--query' ])
}

/**
 * jq/yq subcommand aliases that are not the filter itself (yq eval …).
 */
const FILTER_EVAL_WORDS = new Set([ 'e', 'eval', 'eval-all', 'ea' ])

/**
 * jq flags that consume words from the stream; those words are file (or
 * variable) arguments — they are checked as files and never mistaken for
 * the filter expression.
 */
const BASH_VALUE_FLAGS: Record<string, Record<string, number>> = {
  jq: { '-f': 1, '--from-file': 1, '--slurpfile': 2, '--rawfile': 2 },
  yq: {}
}

export function isHiddenBase(name: string, opts: HiddenGuardOptions = {}): boolean {
  if (name === '.' || name === '..' || !name.startsWith('.')) {
    return false
  }

  if (INFRA_SEGMENTS.has(name) || INFRA_FILES.has(name)) {
    return false
  }

  return !(opts.allow ?? []).includes(name)
}

/**
 * Any path segment that is a hidden file/dir (`.secrets/tokens.json` is
 * hidden because of `.secrets`, not its basename). Returns the first
 * hidden segment, or undefined.
 */
export function pathHasHidden(s: string, opts: HiddenGuardOptions = {}): string | undefined {
  if (s === '' || s.length > 4096) {
    return undefined
  }

  for (const seg of s.split(PATH_SEGMENT_SPLIT_REGEX)) {
    if (seg === '' || [ '.', '..', '~' ].includes(seg)) {
      continue
    }

    if (!seg.startsWith('.')) {
      continue
    }

    // infra dot-dirs (.config, .git, …) are walkable; sensitive hidden
    // dirs (.ssh, .aws) and hidden FILES anywhere in the path are not
    if (INFRA_SEGMENTS.has(seg)) {
      continue
    }

    if (INFRA_FILES.has(seg)) {
      continue
    }

    if (!(opts.allow ?? []).includes(seg)) {
      return seg
    }
  }

  return undefined
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/**
 * True when a tool argument object references a hidden file in any
 * path-ish string value (filePath, path, file, or nested arrays of them).
 */
export function argsTouchHidden(args: unknown, opts: HiddenGuardOptions = {}): string | undefined {
  const seen: unknown[] = []

  const visit = (v: unknown, depth: number): string | undefined => {
    if (v === null || v === undefined || depth > 6) {
      return undefined
    }

    if (typeof v === 'string') {
      // path-ish only: starts with ., / or ~, or a plain dotfile name
      if (v.length > 0 && v.length < 4096 && PATH_ISH_REGEX.test(v)) {
        return pathHasHidden(v, opts)
      }

      return undefined
    }

    if (!isPlainObject(v)) {
      return undefined
    }

    if (seen.includes(v)) {
      return undefined
    }

    seen.push(v)

    for (const [ k, val ] of Object.entries(v)) {
      // prose fields may legitimately mention dotfiles
      if (k === 'text' || k === 'description') {
        continue
      }

      const hit = visit(val, depth + 1)
      if (hit !== undefined) {
        return hit
      }
    }

    return undefined
  }

  return visit(args, 0)
}

const MSG = (name: string, what: string) =>
  `hidden-guard BLOCKED: \`${name}\` is a hidden (dot) file. ${what} Reading hidden files is not allowed (they hold credentials and local state). If you truly need it, ask the user to paste the relevant part.`

export function blockMessage(name: string): string {
  return MSG(name, 'Requested via a tool.')
}

/**
 * Bash layer: any positional file argument whose basename is a hidden file
 * (any command, any reader — cat .env, wc -l .foo, strings .secret …).
 * NOT file args: flags; the value word of expression flags (--jq, --query,
 * --template — jq/JMESPath/Go-template expressions, never paths); value
 * words of known value-flags (checked as files); and the first positional
 * of jq/yq (the filter expression — files come after it).
 */
export function bashTouchesHidden(command: string, opts: HiddenGuardOptions = {}): string | undefined {
  if (opts.disabled === true) {
    return undefined
  }

  let ast: Node

  try {
    // unbash's own AST types are stricter unions; this loose Node is the
    // analyzer's working shape
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    ast = parse(command) as unknown as Node
  } catch {
    // fail open
    return undefined
  }

  const found: string[] = []
  walkBashAst(ast, found, opts)

  if (found.length === 0) {
    return undefined
  }

  return MSG(found.join(', '), 'Found it in a bash command.')
}

function walkBashAst(node: unknown, found: string[], opts: HiddenGuardOptions, depth = 0): void {
  if (node === null || node === undefined || typeof node !== 'object' || depth > 32) {
    return
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      walkBashAst(child, found, opts, depth + 1)
    }

    return
  }

  // parser AST boundary: every value reaching here comes from unbash's parse()
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const n = node as Node
  if (n.type === 'Command') {
    scanCommandWords(n, found, opts)
  }

  for (const k of [ 'command', 'body', 'clause', 'then', 'else', 'wordlist', 'commands' ]) {
    const v = (n as Record<string, unknown>)[k]
    if (v !== null && v !== undefined) {
      walkBashAst(v, found, opts, depth + 1)
    }
  }
}

function scanCommandWords(node: Node, found: string[], opts: HiddenGuardOptions): void {
  const words: Word[] = Array.isArray(node.suffix) ? node.suffix.filter(w => isWord(w)) : []
  const base = (node.name?.text ?? '').split('/').pop() ?? ''
  const exprFlags = EXPR_VALUE_FLAGS[base]
  const valueFlags = BASH_VALUE_FLAGS[base]
  const filterCmd = base === 'jq' || base === 'yq'
  let skipExpr = false
  let consumeValues = 0
  let sawFilter = false

  for (const w of words) {
    if (skipExpr) {
      // expression value (--jq .headSha) — not a file argument
      skipExpr = false
      continue
    }

    if (consumeValues > 0) {
      // flag value word (-f FILE, --slurpfile VAR FILE) — checked as a
      // file, never treated as the filter
      consumeValues--

      const hidden = pathHasHidden(w.text, opts)
      if (hidden !== undefined && !found.includes(w.text)) {
        found.push(w.text)
      }

      continue
    }

    if (w.text.startsWith('-') && w.text !== '-') {
      if (exprFlags?.has(w.text) === true) {
        skipExpr = true
      } else {
        const count = valueFlags?.[w.text]
        if (count !== undefined) {
          consumeValues = count
        }
      }

      continue
    }

    // URLs are not filesystem paths — dot-segments inside them
    // (https://host/.well-known/…) are never hidden-file reads
    if (URL_REGEX.test(w.text)) {
      continue
    }

    if (filterCmd) {
      if (!sawFilter && FILTER_EVAL_WORDS.has(w.text)) {
        continue
      }

      if (!sawFilter) {
        // first positional is the filter expression
        sawFilter = true
        continue
      }
    }

    const hidden = pathHasHidden(w.text, opts)
    if (hidden !== undefined && !found.includes(w.text)) {
      found.push(w.text)
    }
  }
}
