import { describe, expect, it } from 'vitest'
import {
  approvalFor,
  guardCommand,
  LANE_NAME_RE,
  parseLanePorcelain,
  resolveLane,
  WORKTREE_MSG
} from '../src/core'

const DIR = '/repo/project/.lane/trees/fix-login-bug'

/**
 * A completed `question` tool part in the transcript shape opencode stores.
 */
const question = (text: string, answers: string[]) => ({
  type: 'assistant',
  content: [
    {
      type: 'tool',
      name: 'question',
      state: {
        status: 'completed',
        input: { questions: [{ question: text, header: 'Switch lane', options: [{ label: 'Approve' }, { label: 'Reject' }] }] },
        metadata: { answers: [ answers ] }
      }
    }
  ]
})

describe('the lane guard', () => {
  it.each([
    [ 'git worktree add /tmp/x probe', 'add' ],
    [ 'git worktree remove /tmp/x', 'remove' ],
    // only the first blocked subcommand is reported
    [ 'git worktree move a b && git worktree lock a', 'move' ],
    [ 'FOO=1 git --no-pager worktree add x y', 'add' ]
  ])('blocks: %s', (cmd, sub) => {
    expect(guardCommand(cmd)).toStrictEqual({ blocked: WORKTREE_MSG(sub) })
  })

  it.each([
    'git worktree list',
    'git worktree prune',
    'git -C worktree status',
    'git status'
  ])('allows: %s', cmd => {
    expect(guardCommand(cmd)).toBeUndefined()
  })
})

describe('lane name validation', () => {
  it.each([
    [ 'fix-login-bug', true ],
    [ 'a', true ],
    [ 'Fix-Bug', false ],
    [ '-leading', false ],
    [ 'has space', false ],
    [ '', false ],
    [ 'x'.repeat(65), false ]
  ])('%s -> %s', (value, want) => {
    expect(LANE_NAME_RE.test(value)).toBe(want)
  })
})

describe('lane resolution', () => {
  const ROOT = '/repo/project'

  it.each([
    [ 'fix-login-bug', { name: 'fix-login-bug', directory: DIR }],
    [ '.lane/trees/fix-login-bug', { name: 'fix-login-bug', directory: DIR }],
    [ DIR, { name: 'fix-login-bug', directory: DIR }]
  ])('resolves %s', (value, want) => {
    expect(resolveLane(value, ROOT)).toStrictEqual(want)
  })

  it.each([
    '../escape',
    '/etc/passwd',
    'Bad Name',
    ''
  ])('rejects %s', value => {
    expect(resolveLane(value, ROOT)).toBeUndefined()
  })
})

describe('the lane_switch approval gate', () => {
  it.each([
    [ 'approve via option label', [ question(`Switch to lane 'fix-login-bug' at ${DIR}?`, [ 'Approve' ]) ], 'approved' ],
    [ 'approve via phrase', [ question('Switch to fix-login-bug?', [ 'yes, go ahead' ]) ], 'approved' ],
    [ 'approve via OK', [ question('Switch to fix-login-bug?', [ 'OK' ]) ], 'approved' ],
    [ 'reject via option label', [ question('Switch to fix-login-bug?', [ 'Reject' ]) ], 'rejected' ],
    [ 'reject and keep current', [ question('Switch to fix-login-bug?', [ 'no, keep this one' ]) ], 'rejected' ],
    [ 'newest question wins', [ question('Switch to fix-login-bug?', [ 'Approve' ]), question('Switch to fix-login-bug?', [ 'No' ]) ], 'rejected' ],
    [ 'question about another lane', [ question('Switch to lane \'other-lane\'?', [ 'Approve' ]) ], undefined ],
    [ 'ambiguous answer', [ question('Switch to fix-login-bug?', [ 'maybe later' ]) ], undefined ],
    [ 'empty answers', [ question('Switch to fix-login-bug?', []) ], undefined ],
    [
      'content fallback',
      [{ type: 'assistant', content: [{ type: 'tool', name: 'question', state: { status: 'completed', input: { questions: [{ question: `Switch to fix-login-bug at ${DIR}?` }] }, content: [{ type: 'text', text: 'yes, switch' }] } }] }],
      'approved'
    ],
    [
      'content fallback blocked on question text',
      [{ type: 'assistant', content: [{ type: 'tool', name: 'question', state: { status: 'completed', input: { questions: [{ question: 'Should we switch to fix-login-bug?' }] }, content: [{ type: 'text', text: 'Should we switch to fix-login-bug? maybe' }] } }] }],
      undefined
    ],
    [
      'running question ignored',
      [{ type: 'assistant', content: [{ type: 'tool', name: 'question', state: { status: 'running', input: { questions: [{ question: 'Switch to fix-login-bug?' }] }, metadata: { answers: [[ 'Approve' ]] } } }] }],
      undefined
    ]
  ])('%s', (_label, msgs, want) => {
    expect(approvalFor('fix-login-bug', DIR, msgs)).toBe(want)
  })
})

describe('lane inventory parsing', () => {
  const ROOT = '/repo/project'

  it('keeps only .lane/trees entries, with names and branches', () => {
    const out = [
      `worktree ${ROOT}`,
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      `worktree ${ROOT}/.lane/trees/fix-login-bug`,
      'HEAD def456',
      'branch refs/heads/fix-login-bug',
      '',
      `worktree ${ROOT}/.lane/trees/docs-pass`,
      'HEAD 789ghi',
      'detached',
      '',
      'worktree /other/place',
      'HEAD xyz',
      'branch refs/heads/elsewhere',
      ''
    ].join('\n')

    expect(parseLanePorcelain(out, ROOT)).toStrictEqual([
      { name: 'fix-login-bug', directory: `${ROOT}/.lane/trees/fix-login-bug`, branch: 'fix-login-bug' },
      { name: 'docs-pass', directory: `${ROOT}/.lane/trees/docs-pass`, branch: undefined }
    ])
  })

  it('returns [] when there are no lanes', () => {
    expect(parseLanePorcelain(`worktree ${ROOT}\nHEAD abc\nbranch refs/heads/main\n`, ROOT)).toStrictEqual([])
  })
})
