export function codeownersTemplate(entries: Array<{ pattern: string; owners: string }>): string {
  const lines: string[] = []

  for (const [ index, entry ] of entries.entries()) {
    if (index === 1) {
      lines.push('')
    }

    lines.push(`${entry.pattern} ${entry.owners}`.trim())
  }

  return `${lines.join('\n')}\n`
}
