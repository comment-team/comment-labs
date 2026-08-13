import type { AnalysisResult, AmbiguousUsage, OutputFormat } from './types'


const TERMINAL_LIST_LIMIT = 50

export function formatResult(result: AnalysisResult, format: OutputFormat): string {
  if (format === 'json') {
    return formatJson(result)
  }

  if (format === 'csv') {
    return formatCsv(result)
  }

  return formatTerminal(result)
}

function formatTerminal(result: AnalysisResult): string {
  const lines: string[] = [ `Found ${result.dead.length} dead key${result.dead.length === 1 ? '' : 's'}` ]

  const sortedDead = result.dead.toSorted((a, b) => a.full.localeCompare(b.full))

  for (const key of sortedDead.slice(0, TERMINAL_LIST_LIMIT)) {
    lines.push(`  ${key.full}`)
  }

  if (sortedDead.length > TERMINAL_LIST_LIMIT) {
    lines.push(`  ... and ${sortedDead.length - TERMINAL_LIST_LIMIT} more`)
  }

  const ambiguousUsages = uniqueAmbiguousUsages(
    result.usages.filter((usage): usage is AmbiguousUsage => usage.type === 'ambiguous')
  )
  if (ambiguousUsages.length > 0) {
    lines.push(
      '',
      `Found ${ambiguousUsages.length} dynamic call site${ambiguousUsages.length === 1 ? '' : 's'} that may use i18next keys`
    )

    for (const usage of ambiguousUsages.slice(0, TERMINAL_LIST_LIMIT)) {
      lines.push(`  ${usage.file}:${usage.line}:${usage.column} (${usage.namespace}) ${usage.reason}`)
    }

    if (ambiguousUsages.length > TERMINAL_LIST_LIMIT) {
      lines.push(`  ... and ${ambiguousUsages.length - TERMINAL_LIST_LIMIT} more`)
    }

    lines.push('', 'These dynamic calls may reference keys that cannot be statically analyzed.')
  }

  return lines.join('\n')
}

function uniqueAmbiguousUsages(usages: readonly AmbiguousUsage[]): AmbiguousUsage[] {
  const seen = new Set<string>()
  const result: AmbiguousUsage[] = []

  for (const usage of usages) {
    const key = `${usage.file}:${usage.line}:${usage.column}`

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    result.push(usage)
  }

  return result.toSorted((a, b) => {
    const fileComparison = a.file.localeCompare(b.file)

    return fileComparison === 0 ? a.line - b.line || a.column - b.column : fileComparison
  })
}

function formatJson(result: AnalysisResult): string {
  return JSON.stringify(
    {
      dead: result.dead.map(key => ({ namespace: key.namespace, key: key.key, full: key.full })),
      ambiguous: result.ambiguous.map(key => ({ namespace: key.namespace, key: key.key, full: key.full })),
      used: result.used.map(key => ({ namespace: key.namespace, key: key.key, full: key.full }))
    },
    null,
    2
  )
}

function formatCsv(result: AnalysisResult): string {
  const rows: string[] = [ 'namespace,key,status,source' ]

  for (const key of result.dead) {
    rows.push([ key.namespace, key.key, 'dead', key.source.path ].map(value => escapeCsv(value)).join(','))
  }

  for (const key of result.ambiguous) {
    rows.push([ key.namespace, key.key, 'ambiguous', key.source.path ].map(value => escapeCsv(value)).join(','))
  }

  return rows.join('\n')
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replaceAll('"', '""')}"`
  }

  return value
}
