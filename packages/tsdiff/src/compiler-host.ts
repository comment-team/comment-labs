import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { sys, createSourceFile, getDefaultLibFileName, resolveModuleName, type CompilerOptions, type CompilerHost, type ResolvedModule, type ScriptTarget } from 'typescript'


const require = createRequire(import.meta.url)
const typescriptLibDirectory = dirname(require.resolve('typescript'))

const leadingDotSlashPattern = /^\.\//u
const libFilePattern = /^lib\.[\w.]+\.d\.ts$/u

function relativeToCurrentDirectory(fileName: string): string | undefined {
  // the compiler absolutizes module names against the cwd, but inline files are keyed by virtual names
  const currentDirectory = sys.getCurrentDirectory()

  return fileName.startsWith(`${currentDirectory}/`) ? fileName.slice(currentDirectory.length + 1) : undefined
}

export function createCompilerHost(
  options: CompilerOptions,
  files: Record<string, string | undefined>
): CompilerHost {
  return {
    getSourceFile,
    getDefaultLibFileName: compilerOptions => join(typescriptLibDirectory, getDefaultLibFileName(compilerOptions)),
    writeFile: (fileName, content) => sys.writeFile(fileName, content),
    getCurrentDirectory: () => sys.getCurrentDirectory(),
    getDirectories: path => sys.getDirectories(path),
    getCanonicalFileName: fileName =>
      sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase(),
    getNewLine: () => sys.newLine,
    useCaseSensitiveFileNames: () => sys.useCaseSensitiveFileNames,
    fileExists,
    readFile,
    // oxlint-disable-next-line typescript/no-deprecated
    resolveModuleNames
  }

  function readFile(fileName: string): string | undefined {
    const relativeName = relativeToCurrentDirectory(fileName)
    const virtual = files[fileName]
      ?? files[fileName.replace(leadingDotSlashPattern, '')]
      ?? (relativeName === undefined ? undefined : files[relativeName])
    if (virtual !== undefined) {
      return virtual
    }

    // lib files are requested by bare name or against the cwd, but always live in the typescript package
    if (libFilePattern.test(basename(fileName))) {
      return sys.readFile(join(typescriptLibDirectory, basename(fileName)))
    }

    return sys.readFile(fileName)
  }

  function fileExists(fileName: string): boolean {
    return readFile(fileName) !== undefined
  }

  function getSourceFile(fileName: string, languageVersion: ScriptTarget) {
    const sourceText = readFile(fileName)

    return sourceText === undefined
      ? undefined
      : createSourceFile(fileName, sourceText, languageVersion)
  }

  function resolveModuleNames(
    moduleNames: string[],
    containingFile: string
  ): (ResolvedModule | undefined)[] {
    return moduleNames.map(moduleName =>
      resolveModuleName(moduleName, containingFile, options, {
        fileExists,
        readFile
      }).resolvedModule)
  }
}
