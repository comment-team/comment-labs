import type Ajv from 'ajv'
import type Ajv2020 from 'ajv/dist/2020.js'
import type AjvDraft04 from 'ajv-draft-04'


export type ReporterMode = 'cli' | 'github'

export type CliOptions = {
  addRecommended: boolean
  paths: string[]
  reporter: ReporterMode
  updateRecommended: boolean
}

export type SchemaSource
  = | {
    kind: 'url'
    value: string
  }
  | {
    kind: 'file'
    value: string
  }

export type SchemaCatalogEntry = {
  name: string
  description?: string
  fileMatch?: string[]
  url: string
}

export type SchemaHint
  = | {
    source: SchemaSource
    sourceText: string
  }
  | {
    recommendation?: SchemaCatalogEntry
  }

export type ParsedDocument = {
  data: unknown
  schemaHint: SchemaHint
}

export type ValidationIssue = {
  filePath: string
  message: string
  title?: string
  line?: number
  column?: number
}

export type Recommendation = {
  filePath: string
  schema: SchemaCatalogEntry
  line?: number
  column?: number
}

export type CacheRecord<T> = {
  fetchedAt: number
  value: T
}

export type RunResult = {
  issues: ValidationIssue[]
  recommendations: Recommendation[]
  warnings: string[]
  checkedFiles: number
}

export type Logger = {
  progress: (message: string) => void
  startValidation: (total: number) => void
  incrementValidation: (filePath: string) => void
  stopValidation: () => void
}

export type ValidateFunction = ((data: unknown) => boolean) & {
  errors?: {
    instancePath: string
    message?: string
  }[] | null
}

export type ValidatorName = 'draft4' | 'draft7' | 'draft2020'

export type ValidatorCollection = Record<ValidatorName, Ajv | Ajv2020 | AjvDraft04>

export type SchemaStore = {
  findRecommendation: (filePath: string) => Promise<SchemaCatalogEntry | undefined>
  loadJson: (url: string) => Promise<Record<string, unknown>>
}
