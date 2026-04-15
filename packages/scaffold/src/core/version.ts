const semverPrefixPattern = /^(\d+)\.\d+\.\d+/

export function typescriptRangeNeedsUpdate(range: string): boolean {
  const trimmed = range.trim()
  if (trimmed === 'catalog:' || trimmed === 'workspace:*') {
    return false
  }

  const match = semverPrefixPattern.exec(trimmed)
  if (!match) {
    return false
  }

  const major = Number(match[1])

  return Number.isFinite(major) && major < 6
}
