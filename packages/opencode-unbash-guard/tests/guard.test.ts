import { describe, expect, it } from 'vitest'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BASH_GUIDE, GREP_GUIDE, GREP_TOOL_DESCRIPTION, guardCommand, grepSearch } from '../src/core'


type Expectation = true | false | `rewrite:${string}`

const cases: Array<[string, Expectation, string]> = [
  // feature 1: read/write bypass
  [ 'cat foo.txt', true, 'cat on file' ],
  [ 'cat a.txt b.txt', true, 'cat multi' ],
  [ 'head -n 5 file.txt', true, 'head with value flag + file' ],
  [ 'tail -c 100 file', true, 'tail file' ],
  [ 'head foo.txt', true, 'head file' ],
  [ 'less foo', true, 'pager' ],
  [ 'more foo', true, 'pager' ],
  [ 'nl foo', true, 'reader' ],
  [ 'tac foo', true, 'reader' ],
  [ 'bat foo', true, 'reader' ],
  [ 'sed -n \'2,5p\' foo.txt', true, 'sed reading file' ],
  [ 'sed \'s/a/b/\' foo.txt', true, 'sed reading file' ],
  [ 'sed -i \'s/a/b/\' foo.txt', true, 'sed in-place -> edit tool' ],
  [ 'sed --in-place s/a/b/ f', true, 'sed long in-place' ],
  [ 'echo hi > out.txt', true, 'echo redirect write' ],
  [ 'echo hi >> out.txt', true, 'echo append' ],
  [ 'printf \'x\' > o', true, 'printf write' ],
  [ 'cat <<\'EOF\' > f\nhi\nEOF', true, 'heredoc into file' ],
  [ 'cat a.txt > c.txt', true, 'cat concat-write' ],
  [ 'sort < in.txt | head -3', false, 'stream processing + head on pipe: allowed' ],
  // feature 2: tgrep
  [ 'grep foo src/', true, 'grep on dir' ],
  [ 'grep -r foo .', true, 'grep recursive' ],
  [ 'grep \'pat\' file.txt', true, 'grep on file' ],
  [ 'rg foo', true, 'rg bare = recursive cwd' ],
  [ 'rg foo src', true, 'rg with path' ],
  [ 'egrep foo f', true, 'egrep' ],
  [ 'fgrep foo f', true, 'fgrep' ],
  // feature 3: chaining
  [ 'pnpm lint && eslint .', true, '&& chain' ],
  [ 'a || b', true, '|| chain' ],
  [ 'git status; git diff', true, '; chain' ],
  [ '(cd /x; ls)', true, 'subshell multi' ],
  [ '(cd /x && ls)', true, 'subshell &&' ],
  [ 'time pnpm lint && pnpm test', true, 'timed &&' ],
  // substitutions guarded
  [ 'echo $(cat secret.txt) > out', true, 'cmd sub cat' ],
  [ 'x=$(cat config.yaml)', true, 'assignment via sub' ],
  [ 'diff <(cat a) <(cat b)', true, 'proc sub cat' ],
  [ 'echo `cat f`', true, 'backtick cat' ],
  [ 'if grep -q needle file.txt; then echo found; fi', true, 'grep inside if' ],
  // allowed
  [ 'git log | sed -n \'2,5p\'', 'rewrite:git --no-pager -c color.ui=false log --oneline -n 30 | sed -n \'2,5p\'', 'THE carve-out: sed on piped output (plus quiet rewrite)' ],
  [ 'git log | head -5', 'rewrite:git --no-pager -c color.ui=false log --oneline -n 30 | head -5', 'head on pipe (plus rewrite)' ],
  [ 'git diff | tail -20', 'rewrite:git --no-pager -c color.ui=false diff | tail -20', 'tail on pipe (plus rewrite)' ],
  [ 'ps aux | grep node', false, 'grep on stdin pipe' ],
  [ 'rg --files | grep package.json', false, 'grep filtering stdin' ],
  [ 'echo hello', false, 'echo to stdout' ],
  [ 'echo $FOO', false, 'echo var' ],
  [ 'ls -la', false, 'ls' ],
  [ 'mkdir -p foo', false, 'mkdir' ],
  [ 'cp a b', false, 'cp' ],
  [ 'cat', false, 'bare cat (stdin)' ],
  [ 'curl https://example.com | jq .name', 'rewrite:curl https://example.com -sS | jq .name', 'curl quiet in pipeline' ],
  [ 'git commit -m \'fix\'', 'rewrite:git --no-pager -c color.ui=false commit -m \'fix\'', 'git commit global flags' ],
  [ 'for f in *.txt; do wc -l $f; done', false, 'for loop compound' ],
  [ 'grep pattern', false, 'grep reading stdin (no files, no pipe): allowed' ],
  [ 'echo \'run $(cat f) to read\'', false, 'single-quoted literal: no expansion' ],
  [ 'set -x', false, 'shell builtin' ],
  [ 'pwd', false, 'pwd' ],
  [ 'sort < in.txt > out.txt', false, 'sort via redirects: stream processing, not a reader' ],
  // quiet rewrites
  [ 'git log', 'rewrite:git --no-pager -c color.ui=false log --oneline -n 30', 'git log quiet' ],
  [ 'git log -n 50', 'rewrite:git --no-pager -c color.ui=false log -n 50 --oneline', 'bounded count: no extra -n' ],
  [ 'git log --oneline', 'rewrite:git --no-pager -c color.ui=false log --oneline -n 30', 'already oneline: only -n' ],
  [ 'git log --format=%s', 'rewrite:git --no-pager -c color.ui=false log --format=%s -n 30', 'custom format: no --oneline' ],
  [ 'git status', 'rewrite:git --no-pager -c color.ui=false status -sb', 'git status short' ],
  [ 'git diff', 'rewrite:git --no-pager -c color.ui=false diff', 'git diff global flags only' ],
  [ 'git log | head -3', 'rewrite:git --no-pager -c color.ui=false log --oneline -n 30 | head -3', 'pipeline rewrite' ],
  [ 'npm ls', 'rewrite:npm ls --depth=0', 'npm ls depth' ],
  [ 'npm list', 'rewrite:npm list --depth=0', 'npm list depth' ],
  [ 'curl https://example.com', 'rewrite:curl https://example.com -sS', 'curl quiet' ],
  [ 'git --no-pager log', 'rewrite:git --no-pager log --oneline -n 30', 'already has --no-pager: global splice skipped, log rewrite still applies once' ],
  // idempotency: re-fired hook on already-rewritten args must not compound
  [ 'git --no-pager -c color.ui=false log', 'rewrite:git --no-pager -c color.ui=false log --oneline -n 30', 'rewritten once: no flag doubling; unbounded log still gets oneline/-n once' ],
  [ 'git --no-pager -c color.ui=false log --oneline -n 30', false, 'fully rewritten log: stays clean' ],
  [ 'git --no-pager -c color.ui=false status -sb', false, 'fully rewritten status: stays clean' ],
  [ 'GIT_EDITOR=true git --no-pager -c color.ui=false rebase --continue', false, 'env-prefixed rewritten: stays clean' ],
  [ 'git diff | git status', 'rewrite:git --no-pager -c color.ui=false diff | git --no-pager -c color.ui=false status -sb', 'each git node spliced once, independently' ],
  // no rewrite cases
  [ 'npm ls react', false, 'npm ls with arg: no depth splice (and allowed)' ],
  [ 'npm run build', false, 'npm run: untouched' ],
  [ 'curl -s https://x', false, 'curl already silent' ],
  [ 'set x (cat f)', false, 'fish-ish garbage: fail open, unchanged' ]
]

describe('guardCommand', () => {
  it('blocks / passes / rewrites per case', () => {
    expect.assertions(1)

    const failures: string[] = []

    for (const [ cmd, expected, why ] of cases) {
      const r = guardCommand(cmd)
      if (expected === true) {
        if (r.blocked === undefined) {
          failures.push(`not blocked [${why}]: ${cmd} → ${JSON.stringify(r.command)}`)
        } else if (r.command !== cmd) {
          failures.push(`blocked but rewritten [${why}]: ${cmd}`)
        }
      } else if (expected === false) {
        if (r.blocked !== undefined || r.command !== cmd) {
          failures.push(`[${why}]: ${cmd} → blocked=${r.blocked ?? false} out=${JSON.stringify(r.command)}`)
        }
      } else if (typeof expected === 'string' && expected.startsWith('rewrite:')) {
        const want = expected.slice(8)
        if (r.blocked !== undefined) {
          failures.push(`blocked [${why}]: ${cmd}`)
        } else if (r.command !== want) {
          failures.push(`rewrite [${why}]:\n  cmd:  ${cmd}\n  got:  ${JSON.stringify(r.command)}\n  want: ${JSON.stringify(want)}`)
        }
      }
    }

    expect(failures.join('\n')).toBe('')
  })
})


describe('grep tool core', () => {
  it('searches, auto-indexes, filters and truncates', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'unbash-guard-'))
    execSync('git init -q', { cwd: repo })
    execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m x', { cwd: repo })
    mkdirSync(join(repo, 'sub'), { recursive: true })
    writeFileSync(join(repo, 'a.txt'), 'hello world\nalpha hello\n')
    writeFileSync(join(repo, 'sub', 'b.txt'), 'beta hello\n')
    writeFileSync(join(repo, 'sub', 'notes.md'), 'hello in md\n')

    const ctx = { base: repo, signal: new AbortController().signal }

    const r1 = await grepSearch({ pattern: 'hello', path: repo }, ctx)
    expect(r1.output).toContain('Found 4 matches')
    expect(r1.output).toContain('Line 2:')
    expect(r1.output).toContain('a.txt:')

    expect(existsSync(join(repo, '.tgrep'))).toBeTruthy()

    const r2 = await grepSearch({ pattern: 'zzznope', path: repo }, ctx)
    expect(r2.output).toBe('No files found')

    const r3 = await grepSearch({ pattern: 'hello', path: repo, include: '*.md' }, ctx)
    expect(r3.output).toContain('notes.md')
    expect(r3.output).not.toContain('a.txt')

    const r4 = await grepSearch({ pattern: 'beta', path: join(repo, 'sub', 'b.txt') }, ctx)
    expect(r4.output).toContain('Found 1 matches')
    expect(r4.output).toContain('b.txt')

    // stale index (>1h) must be refreshed automatically
    const idx = join(repo, '.tgrep')
    const old = new Date(Date.now() - 7_200_000)
    utimesSync(idx, old, old)
    await grepSearch({ pattern: 'hello', path: repo }, ctx)
    expect(statSync(idx).mtimeMs).toBeGreaterThan(Date.now() - 60_000)
  })
})

describe('exports', () => {
  it('descriptions carry the guidance', () => {
    expect(GREP_TOOL_DESCRIPTION).toContain('tgrep')
    expect(GREP_GUIDE).toContain('trigram')
    expect(BASH_GUIDE).toContain('unbash-guard rules')
  })
})
