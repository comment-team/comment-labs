import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { join, resolve } from 'node:path'


const fixturesRoot = join(import.meta.dirname, 'fixtures')
const testConfigPath = resolve(import.meta.dirname, 'test-oxlint.config.ts')

interface OxlintMessage {
  ruleId: string
  message: string
  line: number
  column: number
  severity: 'error' | 'warning'
}

interface OxlintDiagnostic {
  message: string
  code: string
  severity: 'error' | 'warning'
  labels?: Array<{
    span: {
      line: number
      column: number
    }
  }>
}

interface OxlintResult {
  filePath: string
  messages: OxlintMessage[]
  errorCount: number
  warningCount: number
}

function parseDiagnostics(output: string): OxlintMessage[] {
  try {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const parsed = JSON.parse(output) as { diagnostics?: OxlintDiagnostic[] }

    return (parsed.diagnostics ?? []).map(diagnostic => {
      const span = diagnostic.labels?.[0]?.span ?? { line: 0, column: 0 }

      return {
        ruleId: diagnostic.code,
        message: diagnostic.message,
        line: span.line,
        column: span.column,
        severity: diagnostic.severity
      }
    })
  } catch {
    return []
  }
}

function runOxlint(cwd: string, filePath: string): OxlintResult {
  const absoluteFilePath = resolve(cwd, filePath)
  const command = `oxlint --disable-nested-config --config "${testConfigPath}" --format json "${absoluteFilePath}"`

  try {
    const output = execSync(command, {
      cwd,
      encoding: 'utf8',
      stdio: [ 'pipe', 'pipe', 'pipe' ]
    })

    const messages = parseDiagnostics(output)

    return {
      filePath,
      messages,
      errorCount: messages.filter(message => message.severity === 'error').length,
      warningCount: messages.filter(message => message.severity === 'warning').length
    }
  } catch (error) {
    // oxlint returns non-zero exit code when there are errors
    if (error instanceof Error && 'stdout' in error) {
      const messages = parseDiagnostics(String(error.stdout))

      return {
        filePath,
        messages,
        errorCount: messages.filter(message => message.severity === 'error').length,
        warningCount: messages.filter(message => message.severity === 'warning').length
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
    expect(sortedRuleIds(rules)).toMatchInlineSnapshot(`
      [
        "eslint(arrow-body-style)",
        "eslint(no-eval)",
        "eslint(no-undef)",
        "eslint(no-unreachable)",
        "eslint(no-unreachable)",
        "eslint(no-void)",
        "promise(catch-or-return)",
        "promise(no-return-wrap)",
        "promise(prefer-await-to-then)",
        "security-js(detect-eval-with-expression)",
        "typescript(no-floating-promises)",
        "typescript(no-unsafe-call)",
        "typescript(no-unsafe-member-access)",
        "typescript(promise-function-async)",
        "unicorn(error-message)",
        "unicorn(no-process-exit)",
        "unicorn(no-useless-promise-resolve-reject)",
        "unicorn(prefer-top-level-await)",
        "vitest(require-hook)",
        "vitest(require-hook)",
        "vitest(require-hook)",
      ]
    `)
  })

  it('applies typescript rules to ts files', () => {
    const rules = lintRules('ts', 'src/sample.ts')
    expect(sortedRuleIds(rules, 'typescript(')).toMatchInlineSnapshot(`
      [
        "typescript(no-explicit-any)",
      ]
    `)
  })

  it('applies react rules to jsx files', () => {
    const rules = lintRules('react', 'src/Component.jsx')
    expect(sortedRuleIds(rules, 'react(')).toMatchInlineSnapshot(`
      [
        "react(function-component-definition)",
        "react(jsx-no-undef)",
      ]
    `)
  })

  it('disables no-redeclare in ambient environment type declarations', () => {
    const rules = [
      ...lintRules('ambient', 'src/env.d.ts'),
      ...lintRules('ambient', 'src/environment.d.ts')
    ]
    expect(sortedRuleIds(rules)).not.toContain('eslint(no-redeclare)')
    expect(sortedRuleIds(rules)).not.toContain('no-redeclare')
  })

  it('flags direct self-references in initializers', () => {
    const messages = lintMessages('custom-rule', 'src/self-assign.js')
    const snapshot = messages
      .filter(message => message.ruleId === 'comment-labs-js(no-self-assign)')
      .map(message => ({
        ruleId: message.ruleId,
        message: message.message,
        line: message.line,
        column: message.column
      }))
      .sort((left, right) => left.line - right.line
        || (left.column - right.column)
        || left.message.localeCompare(right.message))

    expect(snapshot).toMatchInlineSnapshot(`
      [
        {
          "column": 15,
          "line": 1,
          "message": "Variable value is referenced within its own initializer.",
          "ruleId": "comment-labs-js(no-self-assign)",
        },
        {
          "column": 28,
          "line": 3,
          "message": "Variable param is referenced within its own initializer.",
          "ruleId": "comment-labs-js(no-self-assign)",
        },
        {
          "column": 11,
          "line": 8,
          "message": "Variable field is referenced within its own initializer.",
          "ruleId": "comment-labs-js(no-self-assign)",
        },
      ]
    `)
  })

  it('ignores callback usages in initializers', () => {
    const messages = lintMessages('custom-rule', 'src/self-assign-ok.js')
    const snapshot = messages
      .filter(message => message.ruleId === 'comment-labs-js(no-self-assign)')
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

  it('flags literal JSX text as i18next-js/no-literal-string', () => {
    const messages = lintMessages('i18next', 'src/jsx-text.jsx')
    const snapshot = messages
      .filter(message => message.ruleId === 'i18next-js(no-literal-string)')
      .map(message => ({
        ruleId: message.ruleId,
        message: message.message,
        line: message.line,
        column: message.column
      }))
      .sort((left, right) => left.line - right.line
        || (left.column - right.column)
        || left.message.localeCompare(right.message))

    expect(snapshot).toMatchInlineSnapshot(`
      [
        {
          "column": 11,
          "line": 7,
          "message": "disallow literal string: <h1>Welcome</h1>",
          "ruleId": "i18next-js(no-literal-string)",
        },
        {
          "column": 27,
          "line": 8,
          "message": "disallow literal string: <p className="lead">This is a description</p>",
          "ruleId": "i18next-js(no-literal-string)",
        },
        {
          "column": 46,
          "line": 9,
          "message": "disallow literal string: <button type="button" title="Click me">Submit</button>",
          "ruleId": "i18next-js(no-literal-string)",
        },
      ]
    `)
  })
})
