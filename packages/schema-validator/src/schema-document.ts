import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import Ajv from 'ajv'
import Ajv2020 from 'ajv/dist/2020.js'
import draft06MetaSchema from 'ajv/dist/refs/json-schema-draft-06.json' with { type: 'json' }
import AjvDraft04 from 'ajv-draft-04'
import { applyEdits, format, modify, parse as parseJson, printParseErrorCode, type ParseError } from 'jsonc-parser'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import YAML from 'yaml'

import { FileLocationError } from './reporting'
import type {
  ParsedDocument,
  SchemaHint,
  SchemaSource,
  SchemaStore,
  ValidationIssue,
  ValidateFunction,
  ValidatorCollection,
  ValidatorName
} from './types'


const yamlSchemaCommentRegex = /^[\t ]*#\s*yaml-language-server:\s*\$schema=([^\s#]+)[\t ]*$/m
const tomlSchemaCommentRegex = /^[\t ]*#:\s*schema\s+(\S+)[\t ]*$/im
const indentSizeRegex = /^( +)\S/mu
const urlSchemeRegex = /^https?:\/\//u

export function createValidators(schemaStore: SchemaStore): ValidatorCollection {
  const sharedOptions = {
    allErrors: true,
    allowUnionTypes: true,
    loadSchema: schemaStore.loadJson.bind(schemaStore),
    strict: false,
    validateFormats: false
  }

  const draft7 = new Ajv(sharedOptions)
  draft7.addMetaSchema(draft06MetaSchema)

  return {
    draft4: new AjvDraft04(sharedOptions),
    draft7,
    draft2020: new Ajv2020(sharedOptions)
  }
}

export function getValidatorName(schema: Record<string, unknown>): ValidatorName {
  const schemaDialect = typeof schema.$schema === 'string' ? schema.$schema : ''

  if (schemaDialect.includes('draft-04')) {
    return 'draft4'
  }

  if (schemaDialect.includes('draft-06') || schemaDialect.includes('draft-07')) {
    return 'draft7'
  }

  return 'draft2020'
}

export function getSupportedExtension(filePath: string): '.json' | '.jsonc' | '.json5' | '.yaml' | '.yml' | '.toml' | null {
  const extension = path.extname(filePath).toLowerCase()

  switch (extension) {
    case '.json':
    case '.jsonc':
    case '.json5':
    case '.yaml':
    case '.yml':
    case '.toml':
      return extension
    default:
      return null
  }
}

export async function parseDocument(filePath: string, schemaStore: SchemaStore): Promise<ParsedDocument> {
  const extension = getSupportedExtension(filePath)
  if (extension === null) {
    throw new Error(`Unsupported file extension for ${filePath}`)
  }

  const content = await readFile(filePath, 'utf8')

  switch (extension) {
    case '.json':
    case '.jsonc':
    case '.json5':
      return {
        data: parseJsonWithLocation(content, true),
        schemaHint: await readJsonSchemaHint(content, filePath, schemaStore, true)
      }
    case '.yaml':
    case '.yml':
      return {
        data: YAML.parse(content),
        schemaHint: await readYamlSchemaHint(content, filePath, schemaStore)
      }
    case '.toml':
      return {
        data: parseToml(content),
        schemaHint: await readTomlSchemaHint(content, filePath, schemaStore)
      }
    default:
      throw new Error(`Unsupported file extension for ${filePath}`)
  }
}

export async function writeSchemaHint(filePath: string, schemaText: string): Promise<string> {
  const extension = getSupportedExtension(filePath)
  if (extension === null) {
    throw new Error(`Unsupported file extension for ${filePath}`)
  }

  const content = await readFile(filePath, 'utf8')

  switch (extension) {
    case '.json':
    case '.jsonc':
    case '.json5':
      return addRecommendedJsonSchema(filePath, content, schemaText, true)
    case '.yaml':
    case '.yml':
      return addRecommendedYamlSchema(filePath, content, schemaText)
    case '.toml':
      return addRecommendedTomlSchema(filePath, content, schemaText)
    default:
      throw new Error(`Unsupported file extension for ${filePath}`)
  }
}

export async function convertIndent(filePath: string, indent: { insertSpaces: boolean; tabSize: number }): Promise<void> {
  const extension = getSupportedExtension(filePath)
  if (extension === null) {
    return
  }

  const content = await readFile(filePath, 'utf8')
  if (content.length === 0) {
    return
  }

  const eol = detectEol(content)

  switch (extension) {
    case '.json':
    case '.jsonc':
    case '.json5': {
      const edits = format(content, undefined, {
        eol,
        insertSpaces: indent.insertSpaces,
        tabSize: indent.tabSize
      })
      if (edits.length > 0) {
        const nextContent = applyEdits(content, edits)
        await writeFile(filePath, nextContent, 'utf8')
      }
      break
    }
    case '.yaml':
    case '.yml': {
      const data = YAML.parse(content)
      const nextContent = YAML.stringify(data, null, {
        indent: indent.insertSpaces ? indent.tabSize : 2
      })
      await writeFile(filePath, nextContent, 'utf8')
      break
    }
    case '.toml': {
      const data = parseToml(content)
      const nextContent = stringifyToml(data)
      await writeFile(filePath, nextContent, 'utf8')
      break
    }
  }
}

export async function validateFileAgainstSchema(
  filePath: string,
  data: unknown,
  sourceText: string,
  validatorCache: Map<string, Promise<ValidateFunction>>,
  validators: ValidatorCollection,
  schemaStore: SchemaStore,
  issues: ValidationIssue[],
  logger: { progress: (message: string) => void }
): Promise<void> {
  const schemaUrl = resolveSchemaSource(filePath, toSchemaSource(filePath, sourceText))
  await validateFileAgainstResolvedSchema(
    filePath,
    data,
    schemaUrl,
    sourceText,
    validatorCache,
    validators,
    schemaStore,
    issues,
    logger
  )
}

export async function validateFileAgainstResolvedSchema(
  filePath: string,
  data: unknown,
  schemaUrl: string,
  sourceText: string,
  validatorCache: Map<string, Promise<ValidateFunction>>,
  validators: ValidatorCollection,
  schemaStore: SchemaStore,
  issues: ValidationIssue[],
  logger: { progress: (message: string) => void }
): Promise<void> {
  logger.progress(`Loading schema for ${path.relative(process.cwd(), filePath) || filePath}: ${sourceText}`)

  let validatePromise = validatorCache.get(schemaUrl)
  if (!validatePromise) {
    validatePromise = (async () => {
      const schema = await schemaStore.loadJson(schemaUrl)
      const validatorName = getValidatorName(schema)
      logger.progress(`Compiling ${validatorName} validator for schema: ${sourceText}`)

      return validators[validatorName].compileAsync(schema)
    })()
    validatorCache.set(schemaUrl, validatePromise)
  }

  const validate = await validatePromise
  const valid = validate(data)

  if (!valid) {
    const errorList = validate.errors ?? []
    if (errorList.length === 0) {
      issues.push({
        filePath,
        message: `Validation failed against ${sourceText}`
      })

      return
    }

    for (const error of errorList) {
      const location = error.instancePath || '/'
      issues.push({
        filePath,
        message: `${location}: ${error.message ?? 'validation error'} (${sourceText})`
      })
    }
  }
}

function parseJsonWithLocation(content: string, allowComments = false): unknown {
  const errors: ParseError[] = []
  const parsed: unknown = parseJson(content, errors, {
    allowTrailingComma: allowComments,
    disallowComments: !allowComments
  })

  if (errors.length > 0) {
    const firstError = errors[0]
    if (!firstError) {
      throw new FileLocationError('Invalid JSON', { title: 'Invalid JSON' })
    }

    const { column, line } = getLineAndColumn(content, firstError.offset)
    const errorCode = printParseErrorCode(firstError.error)

    throw new FileLocationError(`Invalid JSON: ${errorCode} at line ${line}, column ${column}`, {
      title: 'Invalid JSON',
      line,
      column
    })
  }

  return parsed
}

function getLineAndColumn(content: string, position: number): { line: number; column: number } {
  let line = 1
  let column = 1

  for (let index = 0; index < position && index < content.length; index += 1) {
    if (content[index] === '\n') {
      line += 1
      column = 1
      continue
    }

    column += 1
  }

  return { line, column }
}

async function addRecommendedJsonSchema(
  filePath: string,
  content: string,
  schemaUrl: string,
  allowComments = false
): Promise<string> {
  const parsed = parseJsonWithLocation(content, allowComments)
  if (!isRecord(parsed)) {
    throw new Error('Recommended schema can only be added to a JSON object at the document root')
  }

  const edits = modify(content, [ '$schema' ], schemaUrl, {
    formattingOptions: {
      eol: detectEol(content),
      insertSpaces: !content.includes('\t'),
      tabSize: detectIndentSize(content)
    },
    getInsertionIndex(properties) {
      return properties.includes('$schema') ? properties.indexOf('$schema') : 0
    }
  })

  const nextContent = applyEdits(content, edits)
  await writeFile(filePath, nextContent, 'utf8')

  return schemaUrl
}

async function addRecommendedYamlSchema(filePath: string, content: string, schemaUrl: string): Promise<string> {
  const comment = `# yaml-language-server: $schema=${schemaUrl}`
  const nextContent = yamlSchemaCommentRegex.test(content)
    ? content.replace(yamlSchemaCommentRegex, comment)
    : (content.length === 0 ? `${comment}\n` : `${comment}\n${content}`)
  await writeFile(filePath, nextContent, 'utf8')

  return schemaUrl
}

async function addRecommendedTomlSchema(filePath: string, content: string, schemaUrl: string): Promise<string> {
  const comment = `#:schema ${schemaUrl}`
  const nextContent = tomlSchemaCommentRegex.test(content)
    ? content.replace(tomlSchemaCommentRegex, comment)
    : (content.length === 0 ? `${comment}\n` : `${comment}\n${content}`)
  await writeFile(filePath, nextContent, 'utf8')

  return schemaUrl
}

function detectEol(content: string): string {
  return content.includes('\r\n') ? '\r\n' : '\n'
}

function detectIndentSize(content: string): number {
  const match = indentSizeRegex.exec(content)

  return match?.[1]?.length ?? 2
}

async function readJsonSchemaHint(
  content: string,
  filePath: string,
  schemaStore: SchemaStore,
  allowComments = false
): Promise<SchemaHint> {
  const parsed = parseJsonWithLocation(content, allowComments)
  if (!isRecord(parsed)) {
    return {
      recommendation: await schemaStore.findRecommendation(filePath)
    }
  }

  const schemaValue = typeof parsed.$schema === 'string' ? parsed.$schema : undefined
  if (schemaValue !== undefined && schemaValue.length > 0) {
    return {
      source: toSchemaSource(filePath, schemaValue),
      sourceText: schemaValue
    }
  }

  return {
    recommendation: await schemaStore.findRecommendation(filePath)
  }
}

async function readYamlSchemaHint(content: string, filePath: string, schemaStore: SchemaStore): Promise<SchemaHint> {
  const match = yamlSchemaCommentRegex.exec(content)
  const schemaValue = match?.[1]
  if (schemaValue !== undefined && schemaValue.length > 0) {
    return {
      source: toSchemaSource(filePath, schemaValue),
      sourceText: schemaValue
    }
  }

  return {
    recommendation: await schemaStore.findRecommendation(filePath)
  }
}

async function readTomlSchemaHint(content: string, filePath: string, schemaStore: SchemaStore): Promise<SchemaHint> {
  const match = tomlSchemaCommentRegex.exec(content)
  const schemaValue = match?.[1]
  if (schemaValue !== undefined && schemaValue.length > 0) {
    return {
      source: toSchemaSource(filePath, schemaValue),
      sourceText: schemaValue
    }
  }

  return {
    recommendation: await schemaStore.findRecommendation(filePath)
  }
}

function toSchemaSource(filePath: string, schemaText: string): SchemaSource {
  if (urlSchemeRegex.test(schemaText)) {
    return {
      kind: 'url',
      value: schemaText
    }
  }

  return {
    kind: 'file',
    value: path.resolve(path.dirname(filePath), schemaText)
  }
}

export function resolveSchemaSource(filePath: string, source: SchemaSource): string {
  if (source.kind === 'url') {
    return source.value
  }

  if (!existsSync(source.value)) {
    const relative = path.relative(path.dirname(filePath), source.value)

    throw new Error(`Schema file not found: ${relative}`)
  }

  return pathToFileUrl(source.value)
}

function pathToFileUrl(filePath: string): string {
  let normalizedPath = path.resolve(filePath).replaceAll('\\', '/')
  if (!normalizedPath.startsWith('/')) {
    normalizedPath = `/${normalizedPath}`
  }

  return new URL(`file://${normalizedPath}`).href
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
