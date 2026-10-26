import {
  ModuleKind,
  ModuleResolutionKind,
  ScriptTarget,
  SymbolFlags,
  type CompilerOptions,
  type Program,
  type SourceFile,
  // aliased: 'Symbol' (the TS compiler API interface) would trip typescript/ban-types, which flags the primitive-wrapper name
  type Symbol as TsSymbol,
  type Type,
  type TypeChecker,
  createProgram
} from 'typescript'
import { createCompilerHost } from './compiler-host'


type ExportedFiles = { base: string; candidate: string } & Record<string, string | undefined>
type CompatibilityOptions = {
  base: string
  candidate: string
  options: { files?: ExportedFiles; compilerOptions?: CompilerOptions }
}
type Message = { message: string }
type CompatibilityResult = { success: true; warnings: Message[]; changes: Message[] }
  | { success: false; errors: Message[]; warnings: Message[]; changes: Message[] }

const defaultCompilerOptions: CompilerOptions = {
  target: ScriptTarget.ES2022,
  module: ModuleKind.ESNext,
  moduleResolution: ModuleResolutionKind.Bundler,
  // full lib file names, as the tsconfig parser would normalize them
  lib: [ 'lib.es2022.d.ts', 'lib.dom.d.ts' ]
}

function getExportsOfSourceFile(checker: TypeChecker, sourceFile: SourceFile): TsSymbol[] {
  // SourceFile.symbol is an internal API removed from the public types in TS 6, but it exists at runtime
  const moduleSymbol = (sourceFile as SourceFile & { symbol?: TsSymbol }).symbol

  return moduleSymbol === undefined ? [] : checker.getExportsOfModule(moduleSymbol)
}

function resolveAlias(checker: TypeChecker, symbol: TsSymbol): TsSymbol {
  return symbol.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
}

function kindName(symbol: TsSymbol): string {
  return symbol.flags & SymbolFlags.Value ? 'value' : 'type'
}

function typeOfSymbol(checker: TypeChecker, symbol: TsSymbol): Type {
  const declaration = symbol.declarations?.[0]

  // getTypeOfSymbol works for values (including overloaded functions and default
  // exports) but not for type-only symbols, so dispatch on the symbol flags
  return declaration !== undefined && symbol.flags & (SymbolFlags.Interface | SymbolFlags.TypeAlias)
    ? checker.getTypeAtLocation(declaration)
    : checker.getTypeOfSymbol(symbol)
}

function isImplementable(symbol: TsSymbol): boolean {
  return (symbol.flags & (SymbolFlags.Class | SymbolFlags.Interface | SymbolFlags.Enum | SymbolFlags.TypeAlias)) !== 0
}

export function isCompatible({ base, candidate, options }: CompatibilityOptions): CompatibilityResult {
  const compilerOptions = { ...defaultCompilerOptions, ...options.compilerOptions }
  const { files } = options
  const noFiles = { base: undefined, candidate: undefined }
  const { base: baseContent, candidate: candidateContent, ...extraFiles } = files ?? noFiles
  const fileContents: Record<string, string | undefined> = {
    [base]: baseContent,
    [candidate]: candidateContent,
    ...extraFiles
  }

  const program: Program = createProgram({
    rootNames: [ base, candidate ],
    options: compilerOptions,
    host: createCompilerHost(compilerOptions, fileContents)
  })
  const checker = program.getTypeChecker()

  const baseSourceFile = program.getSourceFile(base)
  const candidateSourceFile = program.getSourceFile(candidate)

  if (!baseSourceFile) {
    throw new Error(`File ${base} not found`)
  }

  if (!candidateSourceFile) {
    throw new Error(`File ${candidate} not found`)
  }

  const errors: Message[] = []
  const warnings: Message[] = []
  const changes: Message[] = []

  const baseExports = getExportsOfSourceFile(checker, baseSourceFile)
  const candidateExports = getExportsOfSourceFile(checker, candidateSourceFile)
  const candidateByName = new Map(candidateExports.map(symbol => [ symbol.getName(), symbol ]))
  const baseNames = new Set(baseExports.map(symbol => symbol.getName()))

  for (const baseExport of baseExports) {
    const name = baseExport.getName()
    const baseSymbol = resolveAlias(checker, baseExport)
    const candidateExport = candidateByName.get(name)

    if (candidateExport === undefined) {
      errors.push({ message: `Exported ${kindName(baseSymbol)} ${name} from base is missing in candidate file` })
      continue
    }

    const candidateSymbol = resolveAlias(checker, candidateExport)
    const baseType = typeOfSymbol(checker, baseSymbol)
    const candidateType = typeOfSymbol(checker, candidateSymbol)

    // consumer compatibility: values read from the candidate must satisfy the published base types
    if (!checker.isTypeAssignableTo(candidateType, baseType)) {
      errors.push({ message: `${name} from candidate (${checker.typeToString(candidateType)}) is not assignable to base type (${checker.typeToString(baseType)})` })
    }

    // implementer compatibility: types consumers implement or assign into must not gain new requirements
    if (isImplementable(baseSymbol) && !checker.isTypeAssignableTo(baseType, candidateType)) {
      errors.push({ message: `${name} from base (${checker.typeToString(baseType)}) is not assignable to candidate type (${checker.typeToString(candidateType)})` })
    }
  }

  for (const candidateExport of candidateExports) {
    if (!baseNames.has(candidateExport.getName())) {
      changes.push({ message: `Exported ${kindName(resolveAlias(checker, candidateExport))} ${candidateExport.getName()} added in candidate file` })
    }
  }

  return { success: errors.length === 0, errors, warnings, changes }
}
