export interface ResolvedConfig {
  localeSources: LocaleSource[]
  defaultNS: string
  nsSeparator: string
  keySeparator: string
  fallbackNS: string[]
  preloadNS: string[]
  interpolation: {
    prefix: string
    suffix: string
  }
}

export interface ExtractedConfig {
  defaultNS?: string
  nsSeparator?: string
  keySeparator?: string
  fallbackNS?: string[]
  preloadNS?: string[]
  interpolation?: {
    prefix: string
    suffix: string
  }
  localeSources: LocaleSource[]
}

export type LocaleSource
  = | { type: 'file'; path: string; namespace: string; language: string }
  | { type: 'directory'; path: string }
  | { type: 'inline'; path: string; namespace: string; language: string; data: Record<string, unknown> }

export interface TranslationKey {
  namespace: string
  key: string
  full: string
  source: LocaleSource
}

export interface StaticUsage {
  type: 'static'
  namespace: string
  key: string
  full: string
  file: string
  line: number
  column: number
}

export interface PatternUsage {
  type: 'pattern'
  namespace: string
  prefix: string
  suffix: string
  pattern: string
  file: string
  line: number
  column: number
}

export interface AmbiguousUsage {
  type: 'ambiguous'
  namespace?: string
  reason: string
  file: string
  line: number
  column: number
}

export type Usage = StaticUsage | PatternUsage | AmbiguousUsage

export interface AnalysisResult {
  dead: TranslationKey[]
  ambiguous: TranslationKey[]
  used: TranslationKey[]
  usages: Usage[]
}

export type OutputFormat = 'terminal' | 'json' | 'csv'

export interface CliOptions {
  'init-file'?: string
  locales?: string
  'default-ns'?: string
  source?: string
  format: OutputFormat
  'fail-on-dead': boolean
  verbose: boolean
  debug: boolean
  help: boolean
}
