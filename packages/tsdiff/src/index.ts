#!/usr/bin/env node

import console from 'node:console'
import { dirname } from 'node:path'
import process from 'node:process'
import sade from 'sade'
import { version } from '../package.json'
import { flattenDiagnosticMessageText, parseJsonConfigFileContent, readConfigFile, sys, version as tsVersion, type CompilerOptions } from 'typescript'
import { isCompatible } from './check'


const program = sade('tsdiff')

program
  .version(`${version} with TypeScript ${tsVersion}`)

function readCompilerOptions(path: string): CompilerOptions {
  const result = readConfigFile(path, fileName => sys.readFile(fileName))

  if (result.error !== undefined) {
    throw new Error(`Failed to read tsconfig at ${path}: ${flattenDiagnosticMessageText(result.error.messageText, sys.newLine)}`)
  }

  return parseJsonConfigFileContent(result.config ?? {}, sys, dirname(path)).options
}

program
  .command('check <base> <candidate>')
  .describe('Check if the candidate file is compatible with all types in the base file')
  .example('check v1.d.ts local.d.ts')
  .option('--tsconfig <path>', 'Path to the tsconfig.json file')
  .action((base: string, candidate: string, options: { tsconfig?: string }) => {
    const result = isCompatible({
      base,
      candidate,
      options: {
        compilerOptions: options.tsconfig === undefined ? undefined : readCompilerOptions(options.tsconfig)
      }
    })

    for (const { message } of result.warnings) {
      console.warn(message)
    }

    if (result.success) {
      for (const { message } of result.changes) {
        console.log(message)
      }
    } else {
      for (const { message } of result.errors) {
        console.error(message)
      }

      process.exitCode = 1
    }
  })

program.parse(process.argv)
