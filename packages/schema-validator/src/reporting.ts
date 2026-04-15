import path from 'node:path'
import process from 'node:process'

import cliProgress from 'cli-progress'
import pc from 'picocolors'

import type { Logger, ReporterMode, Recommendation, RunResult, ValidationIssue } from './types'


export class FileLocationError extends Error {
  column?: number
  line?: number
  title?: string

  constructor(message: string, options: { title?: string; line?: number; column?: number } = {}) {
    super(message)
    this.name = 'FileLocationError'
    this.title = options.title
    this.line = options.line
    this.column = options.column
  }
}

export function printResult(result: RunResult, reporter: ReporterMode): void {
  if (reporter === 'github') {
    for (const issue of result.issues) {
      console.log(toGitHubAnnotation('error', issue.filePath, issue.message, issue.title, issue.line, issue.column))
    }

    for (const recommendation of result.recommendations) {
      const message = `No schema found. SchemaStore suggests ${recommendation.schema.url} (${recommendation.schema.name}).`
      console.log(
        toGitHubAnnotation(
          'warning',
          recommendation.filePath,
          message,
          'Schema recommendation',
          recommendation.line,
          recommendation.column
        )
      )
    }

    for (const warning of result.warnings) {
      console.log(`::warning title=${escapeGithubData('Schema validator warning')}::${escapeGithubData(warning)}`)
    }

    console.log(
      result.issues.length === 0
        ? `Checked ${result.checkedFiles} files with no validation errors.`
        : `Checked ${result.checkedFiles} files and found ${result.issues.length} validation error(s).`
    )

    return
  }

  if (result.issues.length === 0) {
    console.log(`${pc.green('OK')} Checked ${pc.bold(String(result.checkedFiles))} files with no validation errors.`)
  } else {
    console.error(
      `${pc.red('ERROR')} Checked ${pc.bold(String(result.checkedFiles))} files and found ${pc.bold(String(result.issues.length))} validation error(s):`
    )

    for (const issue of result.issues) {
      const location = formatIssueLocation(issue)
      const title = issue.title !== undefined && issue.title.length > 0 ? `${pc.red(pc.bold(issue.title))} ` : ''
      console.error(`- ${pc.cyan(path.relative(process.cwd(), issue.filePath))}${location}: ${title}${issue.message}`)
    }
  }

  if (result.recommendations.length > 0) {
    console.log('')
    console.log(pc.yellow(pc.bold('Schema Recommendations:')))

    for (const recommendation of result.recommendations) {
      console.log(renderRecommendation(recommendation))
    }
  }

  if (result.warnings.length > 0) {
    console.log('')
    console.log(pc.yellow(pc.bold('Warnings:')))

    for (const warning of result.warnings) {
      console.log(`- ${pc.yellow(warning)}`)
    }
  }
}

export function createLogger(): Logger {
  const useProgressBar = process.stderr.isTTY && !isGitHubActions()
  const progressBar = useProgressBar
    ? new cliProgress.SingleBar(
      {
        clearOnComplete: true,
        format: '[schema-validator] {bar} {value}/{total} {file}',
        hideCursor: true
      },
      cliProgress.Presets.shades_classic
    )
    : undefined
  let validationActive = false
  let currentValue = 0
  let totalValue = 0
  let currentFile = ''

  return {
    progress(message: string) {
      if (progressBar) {
        const shouldResume = validationActive
        if (shouldResume) {
          progressBar.stop()
        }

        console.error(`[schema-validator] ${message}`)

        if (shouldResume) {
          progressBar.start(totalValue, currentValue, { file: currentFile })
        }

        return
      }

      console.error(`[schema-validator] ${message}`)
    },
    startValidation(total: number) {
      if (!progressBar || total === 0) {
        return
      }

      validationActive = true
      totalValue = total
      currentValue = 0
      currentFile = ''
      progressBar.start(total, 0, { file: '' })
    },
    incrementValidation(filePath: string) {
      if (!progressBar || !validationActive) {
        return
      }

      currentValue += 1
      currentFile = truncateForProgress(path.basename(filePath))
      progressBar.update(currentValue, { file: currentFile })
    },
    stopValidation() {
      if (!progressBar || !validationActive) {
        return
      }

      progressBar.stop()
      validationActive = false
      currentValue = 0
      totalValue = 0
      currentFile = ''
    }
  }
}

export function toIssueLocation(error: unknown): Pick<ValidationIssue, 'title' | 'line' | 'column'> {
  if (error instanceof FileLocationError) {
    return {
      title: error.title,
      line: error.line,
      column: error.column
    }
  }

  return {}
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function renderRecommendation(recommendation: Recommendation): string {
  return `- ${pc.cyan(path.relative(process.cwd(), recommendation.filePath))}: ${pc.yellow(recommendation.schema.name)} ${pc.dim(recommendation.schema.url)}`
}

function isGitHubActions(): boolean {
  return process.env.GITHUB_ACTIONS === 'true'
}

function formatIssueLocation(issue: { line?: number; column?: number }): string {
  if (issue.line === undefined) {
    return ''
  }

  if (issue.column === undefined) {
    return `:${issue.line}`
  }

  return `:${issue.line}:${issue.column}`
}

function toGitHubAnnotation(
  level: 'error' | 'warning',
  filePath: string,
  message: string,
  title?: string,
  line?: number,
  column?: number
): string {
  const properties = [ `file=${escapeGithubData(filePath)}` ]

  if (line !== undefined) {
    properties.push(`line=${line}`, `endLine=${line}`)
  }

  if (column !== undefined) {
    properties.push(`col=${column}`, `endColumn=${column}`)
  }

  if (title !== undefined && title.length > 0) {
    properties.push(`title=${escapeGithubData(title)}`)
  }

  return `::${level} ${properties.join(',')}::${escapeGithubData(message)}`
}

function escapeGithubData(value: string): string {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A').replaceAll(':', '%3A').replaceAll(',', '%2C')
}

function truncateForProgress(value: string, maxLength = 50): string {
  if (value.length <= maxLength) {
    return value
  }

  return `...${value.slice(-(maxLength - 3))}`
}
