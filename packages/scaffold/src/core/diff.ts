import pc from 'picocolors'


const trailingNewlinePattern = /\n$/

type DiffLine
  = | { type: 'equal'; text: string }
  | { type: 'add'; text: string }
  | { type: 'remove'; text: string }

export function renderDiffPreview(title: string, before: string, after: string): string {
  if (before === after) {
    return `${pc.dim(`# ${title}`)}\n${pc.dim('(no content changes)')}\n`
  }

  const diffLines = diffByLine(before, after)
  const rendered = diffLines.map(line => {
    if (line.type === 'add') {
      return pc.green(`+${line.text}`)
    }

    if (line.type === 'remove') {
      return pc.red(`-${line.text}`)
    }

    return pc.dim(` ${line.text}`)
  }).join('\n')

  return `${pc.bold(title)}\n${pc.dim('--- before')}\n${pc.dim('+++ after')}\n${rendered}\n`
}

function diffByLine(before: string, after: string): DiffLine[] {
  const left = splitLines(before)
  const right = splitLines(after)
  const lcs = buildLcsMatrix(left, right)
  const result: DiffLine[] = []

  let i = 0
  let j = 0

  while (i < left.length && j < right.length) {
    const leftLine = left[i]
    const rightLine = right[j]
    if (leftLine === undefined || rightLine === undefined) {
      break
    }

    if (leftLine === rightLine) {
      result.push({ type: 'equal', text: leftLine })
      i += 1
      j += 1
      continue
    }

    const downScore = lcs[i + 1]?.[j] ?? 0
    const rightScore = lcs[i]?.[j + 1] ?? 0
    if (downScore >= rightScore) {
      result.push({ type: 'remove', text: leftLine })
      i += 1
    } else {
      result.push({ type: 'add', text: rightLine })
      j += 1
    }
  }

  while (i < left.length) {
    const leftLine = left[i]
    if (leftLine !== undefined) {
      result.push({ type: 'remove', text: leftLine })
    }

    i += 1
  }

  while (j < right.length) {
    const rightLine = right[j]
    if (rightLine !== undefined) {
      result.push({ type: 'add', text: rightLine })
    }

    j += 1
  }

  return result
}

function buildLcsMatrix(left: string[], right: string[]): number[][] {
  const matrix = Array.from({ length: left.length + 1 }, () => Array.from<number>({ length: right.length + 1 }).fill(0))

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      const currentRow = matrix[i]
      const nextRow = matrix[i + 1]
      if (!currentRow || !nextRow) {
        continue
      }

      currentRow[j] = left[i] === right[j]
        ? (nextRow[j + 1] ?? 0) + 1
        : Math.max(nextRow[j] ?? 0, currentRow[j + 1] ?? 0)
    }
  }

  return matrix
}

function splitLines(value: string): string[] {
  return value.replaceAll('\r\n', '\n').replace(trailingNewlinePattern, '').split('\n')
}
