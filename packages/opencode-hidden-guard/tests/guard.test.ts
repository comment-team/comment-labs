import { describe, expect, it } from 'vitest'
import { argsTouchHidden, bashTouchesHidden, isHiddenBase, pathHasHidden } from '../src/core'

describe('isHiddenBase', () => {
  it('detects dotfile basenames', () => {
    expect.assertions(9)

    expect(isHiddenBase('.env')).toBeTruthy()
    expect(isHiddenBase('.ssh')).toBeTruthy()
    expect(isHiddenBase('notes.txt')).toBeFalsy()
    expect(isHiddenBase('.')).toBeFalsy()
    expect(isHiddenBase('..')).toBeFalsy()
    expect(isHiddenBase('.env', { allow: [ '.env' ] })).toBeFalsy()
    // infra dot-dirs/files stay readable
    expect(isHiddenBase('.config')).toBeFalsy()
    expect(isHiddenBase('.gitignore')).toBeFalsy()
    expect(isHiddenBase('.git')).toBeFalsy()
  })
})

describe('pathHasHidden', () => {
  it('walks segments but allows infra dot-dirs', () => {
    expect.assertions(5)

    expect(pathHasHidden('.secrets/tokens.json')).toBe('.secrets')
    expect(pathHasHidden('/Users/me/.config/opencode/opencode.json')).toBeUndefined()
    expect(pathHasHidden('/repo/.git/HEAD')).toBeUndefined()
    expect(pathHasHidden('/Users/me/.ssh/id_ed25519')).toBe('.ssh')
    expect(pathHasHidden('src/main.ts')).toBeUndefined()
  })
})

describe('argsTouchHidden', () => {
  it('flags dotfile paths in tool args (any segment)', () => {
    expect.assertions(7)

    expect(argsTouchHidden({ filePath: '/repo/.env' })).toBe('.env')
    expect(pathHasHidden('.secrets/tokens.json')).toBe('.secrets')
    expect(argsTouchHidden({ path: '.secrets/tokens.json' })).toBe('.secrets')
    expect(argsTouchHidden({ path: 'src/main.ts' })).toBeUndefined()
    // infra dot-dirs walkable (the agent must be able to touch its own config)
    expect(argsTouchHidden({ path: '/Users/me/.config/opencode/opencode.json' })).toBeUndefined()
    // prose fields exempt (the model may mention .env in a question)
    expect(argsTouchHidden({ text: 'read .env for me' })).toBeUndefined()
    // nested arrays (glob tool patterns etc.)
    expect(argsTouchHidden({ paths: [ '/a/b', '/x/.npmrc' ] })).toBe('.npmrc')
  })
})

describe('bashTouchesHidden', () => {
  it('blocks hidden-file args in bash commands', () => {
    expect.assertions(7)

    expect(bashTouchesHidden('cat .env')).toContain('.env')
    expect(bashTouchesHidden('wc -l ~/.ssh/id_ed25519')).toContain('id_ed25519')
    expect(bashTouchesHidden('git log --oneline')).toBeUndefined()
    expect(bashTouchesHidden('echo .env')).toContain('.env')
    expect(bashTouchesHidden('git status')).toBeUndefined()
    // infra dot-dirs are walkable in bash too
    expect(bashTouchesHidden('cat ~/.config/opencode/opencode.json')).toBeUndefined()
    // fail open on garbage
    expect(bashTouchesHidden('set x (cat f)')).toBeUndefined()
  })

  it('does not flag expression args (--jq/--query, jq/yq filters)', () => {
    expect.assertions(8)

    // the exact gh false positive that started this
    expect(bashTouchesHidden('gh run view 36475156212 --json headSha --jq .headSha')).toBeUndefined()
    expect(bashTouchesHidden('gh run list --template \'{{.headSha}}\' --jq \'.databaseId\'')).toBeUndefined()
    expect(bashTouchesHidden('aws ec2 describe-instances --query \'.Tags[0].Value\'')).toBeUndefined()
    expect(bashTouchesHidden('az vm list --query \'[0].name\'')).toBeUndefined()
    // jq/yq: the first positional is the filter, files come after it
    expect(bashTouchesHidden('jq \'.user.name\' data.json')).toBeUndefined()
    expect(bashTouchesHidden('cat data.json | jq .status')).toBeUndefined()
    expect(bashTouchesHidden('yq eval \'.metadata.name\' pod.yml')).toBeUndefined()
    expect(bashTouchesHidden('yq \'.a.b\' values.yml')).toBeUndefined()
  })

  it('still flags hidden files around expressions', () => {
    expect.assertions(6)

    expect(bashTouchesHidden('gh run view 123 --jq .x .env')).toContain('.env')
    expect(bashTouchesHidden('jq \'.a\' .env')).toContain('.env')
    expect(bashTouchesHidden('jq . .zshrc')).toContain('.zshrc')
    expect(bashTouchesHidden('jq -f .secrets/prod.jq data.json')).toContain('.secrets')
    expect(bashTouchesHidden('jq --slurpfile x .secret.json data.json')).toContain('.secret.json')
    expect(bashTouchesHidden('yq \'.a\' .zshrc')).toContain('.zshrc')
  })

  it('does not flag URL dot-segments (.well-known etc)', () => {
    expect.assertions(3)

    expect(bashTouchesHidden('curl -s https://mcp.figma.com/.well-known/oauth-protected-resource')).toBeUndefined()
    expect(bashTouchesHidden('open \'https://example.com/.git/config?raw=1\'')).toBeUndefined()
    // other words around a URL are still checked
    expect(bashTouchesHidden('curl -s https://x.com/.well-known/a .env')).toContain('.env')
  })
})
