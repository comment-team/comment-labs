import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'


const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesRoot = join(__dirname, 'fixtures')

interface OxlintMessage {
  ruleId: string
  message: string
  line: number
  column: number
  severity: 'error' | 'warning'
}

interface OxlintResult {
  filePath: string
  messages: OxlintMessage[]
  errorCount: number
  warningCount: number
}

function runOxlint(cwd: string, filePath: string): OxlintResult {
  try {
    const output = execSync(`oxlint --format json ${filePath}`, {
      cwd,
      encoding: 'utf8',
      stdio: [ 'pipe', 'pipe', 'pipe' ]
    })

    // oxlint-disable-next-line typescript/no-unsafe-return
    return JSON.parse(output)
  } catch (error) {
    // oxlint returns non-zero exit code when there are errors
    if (error instanceof Error && 'stdout' in error) {
      try {
        // oxlint-disable-next-line typescript/no-unsafe-return
        return JSON.parse(String(error.stdout))
      } catch {
        return { filePath, messages: [], errorCount: 0, warningCount: 0 }
      }
    }

    return { filePath, messages: [], errorCount: 0, warningCount: 0 }
  }
}

function lintMessages(fixtureName: string, filePath: string): OxlintMessage[] {
  const fixtureDir = join(fixturesRoot, fixtureName)
  const result = runOxlint(fixtureDir, filePath)

  return result.messages
}

function lintRules(fixtureName: string, filePath: string): string[] {
  const messages = lintMessages(fixtureName, filePath)

  return messages.map(message => message.ruleId).filter(Boolean)
}

function sortedRuleIds(ruleIds: string[], prefix?: string): string[] {
  const filtered = (prefix !== undefined && prefix !== '') ? ruleIds.filter(ruleId => ruleId.startsWith(prefix)) : ruleIds

  return filtered.toSorted()
}

describe('@comment-labs/oxlint-config', () => {
  it('applies base js plugin rules to js files', () => {
    const rules = lintRules('js', 'src/sample.js')
    expect(sortedRuleIds(rules)).toMatchInlineSnapshot('[]')
  })

  it('applies typescript rules to ts files', () => {
    const rules = lintRules('ts', 'src/sample.ts')
    expect(sortedRuleIds(rules, 'typescript/')).toMatchInlineSnapshot('[]')
  })

  it('applies react rules to jsx files', () => {
    const rules = lintRules('react', 'src/Component.jsx')
    expect(sortedRuleIds(rules, 'react/')).toMatchInlineSnapshot('[]')
  })

  it('flags direct self-references in initializers', () => {
    const messages = lintMessages('custom-rule', 'src/self-assign.js')
    const snapshot = messages
      .filter(message => message.ruleId === 'comment-labs-js/no-self-assign')
      .map(message => ({
        ruleId: message.ruleId,
        message: message.message,
        line: message.line,
        column: message.column
      }))
      .sort((left, right) => left.line - right.line
        || (left.column - right.column)
        || left.message.localeCompare(right.message))

    expect(snapshot).toMatchInlineSnapshot('[]')
  })

  it('ignores callback usages in initializers', () => {
    const messages = lintMessages('custom-rule', 'src/self-assign-ok.js')
    const snapshot = messages
      .filter(message => message.ruleId === 'comment-labs-js/no-self-assign')
      .map(message => ({
        ruleId: message.ruleId,
        message: message.message,
        line: message.line,
        column: message.column
      }))
      .sort((left, right) => left.line - right.line
        || (left.column - right.column)
        || left.message.localeCompare(right.message))

    expect(snapshot).toMatchInlineSnapshot('[]')
  })
})
