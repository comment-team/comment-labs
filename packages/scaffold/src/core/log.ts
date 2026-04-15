import process from 'node:process'

import pc from 'picocolors'


export function logInfo(message: string): void {
  process.stdout.write(`${pc.cyan('info')} ${message}\n`)
}

export function logWarn(message: string): void {
  process.stdout.write(`${pc.yellow('warn')} ${message}\n`)
}

export function logError(message: string): void {
  process.stderr.write(`${pc.red('error')} ${message}\n`)
}

export function logSuccess(message: string): void {
  process.stdout.write(`${pc.green('success')} ${message}\n`)
}
