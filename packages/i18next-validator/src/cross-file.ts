import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseSync, type StaticImport } from 'oxc-parser'
import {
  getImportedName,
  isArrayExpression,
  isBinaryExpression,
  isCallExpression,
  isConditionalExpression,
  isFunctionExpression,
  isIdentifier,
  isJSXAttribute,
  isJSXElement,
  isJSXIdentifier,
  isLiteralString,
  isMemberExpression,
  isObjectExpression,
  isProperty,
  isRecord,
  isTemplateLiteral,
  isVariableDeclarator
} from './type-guards'
import { readText } from './utils'


export interface CrossFileContext {
  propertyStringMaps: Map<string, string[]>
  functionParameterValues: Map<string, Map<number, string[]>>
  functionPropertyValues: Map<string, Map<string, string[]>>
}

interface SourceUnit {
  file: string
  program: unknown
  staticImports: StaticImport[]
  staticStrings: Map<string, string[]>
}

interface FunctionDefinition {
  key: string
  file: string
  name: string
  params: unknown[]
}

interface ImportReference {
  file: string
  name: string
}

export function buildCrossFileContext(files: string[]): CrossFileContext {
  const units = files.map(file => readSourceUnit(file))
  const propertyStringMaps = new Map<string, string[]>()
  const functions = new Map<string, FunctionDefinition>()
  const imports = new Map<string, Map<string, ImportReference>>()

  for (const unit of units) {
    collectPropertyStrings(unit.program, propertyStringMaps)

    for (const definition of collectFunctions(unit)) {
      functions.set(functionDefinitionLookupKey(definition.file, definition.name), definition)
    }

    imports.set(unit.file, resolveImports(unit))
  }

  const functionParameterValues = new Map<string, Map<number, string[]>>()
  const functionPropertyValues = new Map<string, Map<string, string[]>>()

  for (const unit of units) {
    walk(unit.program, node => {
      if (!isCallExpression(node)) {
        return
      }

      const definition = resolveCalledFunction(node.callee, unit, functions, imports)
      if (definition === undefined) {
        return
      }

      for (const [ index, argument ] of node.arguments.entries()) {
        const values = evaluateStringValues(argument, unit, propertyStringMaps)
        if (values.length === 0) {
          continue
        }

        const parameterValues = functionParameterValues.get(definition.key) ?? new Map<number, string[]>()
        addIndexedValues(parameterValues, index, values)
        functionParameterValues.set(definition.key, parameterValues)
      }
    })

    walk(unit.program, node => {
      if (!isJSXElement(node)) {
        return
      }

      const name = node.openingElement.name
      if (!isJSXIdentifier(name)) {
        return
      }

      const definition = resolveCalledFunction(name, unit, functions, imports)
      if (definition === undefined || !Array.isArray(node.openingElement.attributes)) {
        return
      }

      for (const attribute of node.openingElement.attributes) {
        if (!isJSXAttribute(attribute)) {
          continue
        }

        const property = attribute.name
        if (!isRecord(property) || typeof property.name !== 'string') {
          continue
        }

        const values = evaluateStringValues(attribute.value, unit, propertyStringMaps)
        if (values.length === 0) {
          continue
        }

        const propertyValues = functionPropertyValues.get(definition.key) ?? new Map<string, string[]>()
        addStringValues(propertyValues, property.name, values)
        functionPropertyValues.set(definition.key, propertyValues)
      }
    })
  }

  return { propertyStringMaps, functionParameterValues, functionPropertyValues }
}

export function functionLookupKey(file: string, start: number): string {
  return `${file}:${start}`
}

function functionDefinitionLookupKey(file: string, name: string): string {
  return `${file}:${name}`
}

function readSourceUnit(file: string): SourceUnit {
  const source = readText(file)
  const result = parseSync(file, source)
  const staticStrings = new Map<string, string[]>()

  walk(result.program, node => {
    if (!isVariableDeclarator(node) || !isIdentifier(node.id)) {
      return
    }

    const values = evaluateStringValues(node.init, { staticStrings }, new Map())
    if (values.length > 0) {
      staticStrings.set(node.id.name, values)
    }
  })

  return {
    file,
    program: result.program,
    staticImports: result.module.staticImports,
    staticStrings
  }
}

function collectFunctions(unit: SourceUnit): FunctionDefinition[] {
  const definitions: FunctionDefinition[] = []

  walk(unit.program, node => {
    if (isRecord(node) && node.type === 'FunctionDeclaration' && isIdentifier(node.id) && Array.isArray(node.params)) {
      definitions.push({
        key: functionLookupKey(unit.file, getStart(node)),
        file: unit.file,
        name: node.id.name,
        params: node.params
      })

      return
    }

    if (!isVariableDeclarator(node) || !isIdentifier(node.id)) {
      return
    }

    if (!isFunctionExpression(node.init) && !isArrowFunctionExpression(node.init)) {
      return
    }

    const functionNode = node.init as Record<string, unknown>

    definitions.push({
      key: functionLookupKey(unit.file, getStart(functionNode)),
      file: unit.file,
      name: node.id.name,
      params: Array.isArray(functionNode.params) ? functionNode.params : []
    })
  })

  walk(unit.program, node => {
    if (!isRecord(node) || node.type !== 'ExportDefaultDeclaration') {
      return
    }

    const declaration = node.declaration
    if (!isRecord(declaration) || declaration.type !== 'FunctionDeclaration' || !Array.isArray(declaration.params)) {
      return
    }

    definitions.push({
      key: functionLookupKey(unit.file, getStart(declaration)),
      file: unit.file,
      name: 'default',
      params: declaration.params
    })
  })

  return definitions
}

function resolveImports(unit: SourceUnit): Map<string, ImportReference> {
  const references = new Map<string, ImportReference>()
  const baseDir = dirname(unit.file)

  for (const item of unit.staticImports) {
    const request = item.moduleRequest.value
    if (!request.startsWith('.')) {
      continue
    }

    const file = resolveImportedPath(baseDir, request)
    if (file === undefined) {
      continue
    }

    for (const entry of item.entries) {
      const name = getImportedName(entry)
      if (name !== undefined) {
        references.set(entry.localName.value, { file, name })
      }
    }
  }

  return references
}

function resolveCalledFunction(
  callee: unknown,
  unit: SourceUnit,
  functions: Map<string, FunctionDefinition>,
  imports: Map<string, Map<string, ImportReference>>
): FunctionDefinition | undefined {
  const name = isIdentifier(callee) || isJSXIdentifier(callee) ? callee.name : undefined
  if (name === undefined) {
    return undefined
  }

  const imported = imports.get(unit.file)?.get(name)
  if (imported !== undefined) {
    return functions.get(functionDefinitionLookupKey(imported.file, imported.name))
  }

  return functions.get(functionDefinitionLookupKey(unit.file, name))
}

function evaluateStringValues(
  node: unknown,
  unit: Pick<SourceUnit, 'staticStrings'>,
  propertyStringMaps: Map<string, string[]>
): string[] {
  const expression = unwrapTypeExpression(node)
  if (expression === undefined || expression === null) {
    return []
  }

  if (isLiteralString(expression)) {
    return [ expression.value ]
  }

  if (isIdentifier(expression)) {
    return unit.staticStrings.get(expression.name) ?? []
  }

  if (isMemberExpression(expression) && isIdentifier(expression.object)) {
    const property = getPropertyName(expression.property)
    if (property !== undefined) {
      return propertyStringMaps.get(property) ?? []
    }
  }

  if (isTemplateLiteral(expression)) {
    if (expression.expressions.length > 0) {
      return []
    }

    return [ expression.quasis.map(getTemplateElementValue).join('') ]
  }

  if (isConditionalExpression(expression)) {
    return unique([
      ...evaluateStringValues(expression.consequent, unit, propertyStringMaps),
      ...evaluateStringValues(expression.alternate, unit, propertyStringMaps)
    ])
  }

  if (isBinaryExpression(expression) && expression.operator === '+') {
    const left = evaluateStringValues(expression.left, unit, propertyStringMaps)
    const right = evaluateStringValues(expression.right, unit, propertyStringMaps)
    if (left.length === 0 || right.length === 0) {
      return []
    }

    return unique(left.flatMap(leftValue => right.map(rightValue => leftValue + rightValue)))
  }

  if (isArrayExpression(expression)) {
    return unique(expression.elements.flatMap(element => evaluateStringValues(element, unit, propertyStringMaps)))
  }

  return []
}

function collectPropertyStrings(node: unknown, propertyStringMaps: Map<string, string[]>): void {
  walk(node, value => {
    if (!isObjectExpression(value)) {
      return
    }

    for (const property of value.properties) {
      if (!isProperty(property)) {
        continue
      }

      const name = getPropertyName(property.key)
      const stringValue = evaluateStringValues(property.value, { staticStrings: new Map() }, propertyStringMaps)
      if (name !== undefined && stringValue.length > 0) {
        addStringValues(propertyStringMaps, name, stringValue)
      }
    }
  })
}

function addStringValues(map: Map<string, string[]>, key: string, values: string[]): void {
  const existing = map.get(key) ?? []

  for (const value of values) {
    if (!existing.includes(value)) {
      existing.push(value)
    }
  }

  map.set(key, existing)
}

function addIndexedValues(map: Map<number, string[]>, key: number, values: string[]): void {
  const existing = map.get(key) ?? []

  for (const value of values) {
    if (!existing.includes(value)) {
      existing.push(value)
    }
  }

  map.set(key, existing)
}

function unique(values: string[]): string[] {
  return [ ...new Set(values) ]
}

function getPropertyName(node: unknown): string | undefined {
  if (isIdentifier(node)) {
    return node.name
  }

  if (isLiteralString(node)) {
    return node.value
  }

  return undefined
}

function getTemplateElementValue(node: unknown): string {
  if (!isRecord(node) || !isRecord(node.value)) {
    return ''
  }

  if (typeof node.value.cooked === 'string') {
    return node.value.cooked
  }

  return typeof node.value.raw === 'string' ? node.value.raw : ''
}

function unwrapTypeExpression(node: unknown): unknown {
  if (!isRecord(node)) {
    return node
  }

  if (
    node.type === 'ChainExpression'
    || node.type === 'ParenthesizedExpression'
    || node.type === 'JSXExpressionContainer'
    || node.type === 'TSAsExpression'
    || node.type === 'TSSatisfiesExpression'
    || node.type === 'TSTypeAssertion'
    || node.type === 'TSNonNullExpression'
  ) {
    return unwrapTypeExpression(node.expression)
  }

  return node
}

function resolveImportedPath(baseDir: string, request: string): string | undefined {
  for (const extension of [ '', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs' ]) {
    const candidate = resolve(baseDir, `${request}${extension}`)
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return undefined
}

function getStart(node: unknown): number {
  return isRecord(node) && typeof node.start === 'number' ? node.start : 0
}

// oxlint-disable-next-line promise/prefer-await-to-callbacks
function walk(node: unknown, callback: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      walk(item, callback)
    }

    return
  }

  if (!isRecord(node)) {
    return
  }

  // oxlint-disable-next-line node/callback-return, promise/prefer-await-to-callbacks
  callback(node)

  for (const value of Object.values(node)) {
    walk(value, callback)
  }
}

function isArrowFunctionExpression(node: unknown): node is { params: unknown[]; body: unknown } {
  return isRecord(node) && node.type === 'ArrowFunctionExpression' && Array.isArray(node.params)
}
