/* oxlint-disable max-lines */
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parseSync, Visitor, type StaticImport } from 'oxc-parser'
import { glob } from 'tinyglobby'
import { buildCrossFileContext, functionLookupKey, type CrossFileContext } from './cross-file'
import type { ResolvedConfig, Usage } from './types'
import {
  getImportedName,
  isArrayExpression,
  isArrayPattern,
  isArrowFunctionExpression,
  isBinaryExpression,
  isCallExpression,
  isConditionalExpression,
  isExportDefaultDeclaration,
  isExportNamedDeclaration,
  isFunctionExpression,
  isIdentifier,
  isJSXAttribute,
  isJSXIdentifier,
  isJSXElement,
  isLiteralString,
  isMemberExpression,
  isObjectExpression,
  isObjectPattern,
  isProperty,
  isRecord,
  isTemplateLiteral,
  isVariableDeclaration,
  isVariableDeclarator
} from './type-guards'
import { readText, splitNamespaceKey } from './utils'


const SOURCE_GLOBS = [ '**/*.{ts,tsx,js,jsx,mjs,cjs}' ]

const EXCLUDE_GLOBS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.*/**',
  '**/*.d.ts'
]

const importedStringMapCache = new Map<string, Map<string, string[]>>()

function loadImportedStringMaps(
  staticImports: StaticImport[],
  contextFile: string
): Map<string, string[]> {
  const maps = new Map<string, string[]>()
  const baseDir = dirname(contextFile)

  for (const item of staticImports) {
    const moduleRequest = item.moduleRequest.value

    if (!moduleRequest.startsWith('.') || moduleRequest.endsWith('.json')) {
      continue
    }

    const absolute = resolveImportedPath(baseDir, moduleRequest)
    if (absolute === undefined) {
      continue
    }

    const exportedMaps = loadExportedStringMaps(absolute)

    for (const entry of item.entries) {
      const exportedName = getImportedName(entry)
      if (exportedName === undefined) {
        continue
      }

      const values = exportedMaps.get(exportedName)
      if (values !== undefined) {
        maps.set(entry.localName.value, values)
      }
    }
  }

  return maps
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

function loadExportedStringMaps(absolutePath: string): Map<string, string[]> {
  const cached = importedStringMapCache.get(absolutePath)
  if (cached !== undefined) {
    return cached
  }

  const maps = new Map<string, string[]>()

  try {
    const source = readText(absolutePath)
    const result = parseSync(absolutePath, source)

    for (const statement of result.program.body as unknown[]) {
      if (isExportDefaultDeclaration(statement)) {
        const unwrappedDeclaration = unwrapTypeExpression(statement.declaration)
        if (isObjectExpression(unwrappedDeclaration)) {
          const values = collectObjectStringValues(unwrappedDeclaration)
          if (values.length > 0) {
            maps.set('default', values)
          }
        }
      }

      if (isExportNamedDeclaration(statement)) {
        const declaration = statement.declaration
        if (isVariableDeclaration(declaration)) {
          for (const declarator of declaration.declarations) {
            if (!isVariableDeclarator(declarator) || !isIdentifier(declarator.id)) {
              continue
            }

            const unwrappedInit = unwrapTypeExpression(declarator.init)
            if (!isObjectExpression(unwrappedInit)) {
              continue
            }

            const values = collectObjectStringValues(unwrappedInit)
            if (values.length > 0) {
              maps.set(declarator.id.name, values)
            }
          }
        }
      }
    }
  } catch {
    // ignore unparsable imports
  }

  importedStringMapCache.set(absolutePath, maps)

  return maps
}

function collectObjectStringValues(objectExpression: { properties: unknown[] }): string[] {
  const values: string[] = []

  for (const property of objectExpression.properties) {
    if (!isProperty(property)) {
      continue
    }

    if (isLiteralString(property.value)) {
      values.push(property.value.value)
    }
  }

  return values
}

interface Scope {
  tBindings: Map<string, TBinding>
  stringBindings: Map<string, string[]>
}

interface TBinding {
  namespace: string
  keyPrefix?: string
}

interface ScanState {
  scopes: Scope[]
  usages: Usage[]
  file: string
  source: string
  lineStarts: number[]
  config: ResolvedConfig
  defaultI18nextNames: Set<string>
  useTranslationNames: Set<string>
  getFixedTNames: Set<string>
  transComponentNames: Set<string>
  stringMaps: Map<string, string[]>
  staticStringBindings: Map<string, string[]>
  propertyStringMaps: Map<string, string[]>
  ignoredCalls: Set<unknown>
  crossFile: CrossFileContext
}

export async function findSourceFiles(target: string): Promise<string[]> {
  if (existsSync(target) && (await stat(target)).isFile()) {
    return [ resolve(target) ]
  }

  return await glob(SOURCE_GLOBS, {
    cwd: target,
    ignore: EXCLUDE_GLOBS,
    absolute: true
  })
}

export function scanSourceFiles(files: string[], config: ResolvedConfig): Usage[] {
  const crossFile = buildCrossFileContext(files)
  const usages: Usage[] = []

  for (const file of files) {
    usages.push(...scanFileInternal(file, config, crossFile))
  }

  return usages
}

export function scanFile(file: string, config: ResolvedConfig): Usage[] {
  return scanFileInternal(file, config, buildCrossFileContext([ file ]))
}

function scanFileInternal(file: string, config: ResolvedConfig, crossFile: CrossFileContext): Usage[] {
  const source = readText(file)
  const result = parseSync(file, source)

  const defaultI18nextNames = new Set<string>()
  const useTranslationNames = new Set<string>()
  const getFixedTNames = new Set<string>()
  const transComponentNames = new Set<string>()

  for (const item of result.module.staticImports) {
    const moduleSource = item.moduleRequest.value
    if (moduleSource !== 'i18next' && moduleSource !== 'react-i18next') {
      continue
    }

    for (const entry of item.entries) {
      const localName = entry.localName.value
      const importedName = entry.importName
      // oxlint-disable-next-line typescript/no-unsafe-enum-comparison
      if (importedName.kind === 'Default') {
        defaultI18nextNames.add(localName)
        continue
      }

      switch (importedName.name) {
        case 'useTranslation':
          useTranslationNames.add(localName)
          break
        case 'getFixedTFunction':
          getFixedTNames.add(localName)
          break
        case 'Trans':
          transComponentNames.add(localName)
          break
        case null:
          break
      }
    }
  }

  const stringMaps = loadImportedStringMaps(result.module.staticImports, file)

  const state: ScanState = {
    scopes: [],
    usages: [],
    file,
    source,
    lineStarts: buildLineStarts(source),
    config,
    defaultI18nextNames,
    useTranslationNames,
    getFixedTNames,
    transComponentNames,
    stringMaps,
    staticStringBindings: new Map(),
    propertyStringMaps: new Map(),
    ignoredCalls: new Set(),
    crossFile
  }

  pushScope(state)

  const visitor = new Visitor({
    FunctionDeclaration(node) {
      enterFunction(node, state)
    },
    'FunctionDeclaration:exit'() {
      popScope(state)
    },
    FunctionExpression(node) {
      enterFunction(node, state)
    },
    'FunctionExpression:exit'() {
      popScope(state)
    },
    ArrowFunctionExpression(node) {
      enterFunction(node, state)
    },
    'ArrowFunctionExpression:exit'() {
      popScope(state)
    },
    VariableDeclarator(node) {
      handleVariableDeclarator(node, state)
    },
    CallExpression(node) {
      handleCallExpression(node, state)
    },
    JSXElement(node) {
      handleJSXElement(node, state)
    }
  })

  visitor.visit(result.program)

  return state.usages
}

function pushScope(state: ScanState): void {
  state.scopes.push({ tBindings: new Map(), stringBindings: new Map() })
}

function enterFunction(node: unknown, state: ScanState): void {
  pushScope(state)

  if (!isRecord(node) || !Array.isArray(node.params)) {
    return
  }

  const parameterValues = state.crossFile.functionParameterValues.get(
    functionLookupKey(state.file, typeof node.start === 'number' ? node.start : 0)
  )
  const propertyValues = state.crossFile.functionPropertyValues.get(
    functionLookupKey(state.file, typeof node.start === 'number' ? node.start : 0)
  )

  for (const [ index, parameter ] of node.params.entries()) {
    const expression = unwrapTypeExpression(parameter)
    if (isIdentifier(expression)) {
      const values = parameterValues?.get(index)
      if (values !== undefined) {
        currentScope(state)?.stringBindings.set(expression.name, values)
      }

      continue
    }

    if (!isObjectPattern(expression)) {
      continue
    }

    for (const property of expression.properties) {
      if (!isProperty(property) || !isIdentifier(property.value)) {
        continue
      }

      const propertyName = getPropertyName(property.key)
      const values = propertyName === undefined ? undefined : propertyValues?.get(propertyName)
      if (values !== undefined) {
        currentScope(state)?.stringBindings.set(property.value.name, values)
      }
    }
  }
}

function popScope(state: ScanState): void {
  state.scopes.pop()
}

function currentScope(state: ScanState): Scope | undefined {
  return state.scopes.at(-1)
}

function addBinding(state: ScanState, name: string, binding: TBinding): void {
  const scope = currentScope(state)
  if (scope === undefined) {
    return
  }

  scope.tBindings.set(name, binding)
}

function resolveBinding(state: ScanState, name: string): TBinding | undefined {
  for (let index = state.scopes.length - 1; index >= 0; index--) {
    const scope = state.scopes[index]
    if (scope === undefined) {
      continue
    }

    if (scope.tBindings.has(name)) {
      return scope.tBindings.get(name)
    }
  }

  return undefined
}

function handleVariableDeclarator(node: unknown, state: ScanState): void {
  if (!isVariableDeclarator(node)) {
    return
  }

  const init = node.init
  const id = node.id
  if (id === undefined) {
    return
  }

  if (isCallExpression(init)) {
    const binding = extractBindingFromHook(init, state)
    if (binding !== undefined) {
      addNamespaceBinding(state, id, binding)

      return
    }
  }

  if (isIdentifier(id)) {
    collectStringMap(state, id, init)

    const wrapperBinding = extractWrapperBinding(init, state)
    if (wrapperBinding !== undefined) {
      addBinding(state, id.name, wrapperBinding)
    }
  }
}

function addNamespaceBinding(state: ScanState, id: unknown, binding: TBinding): void {
  if (isIdentifier(id)) {
    addBinding(state, id.name, binding)

    return
  }

  if (isArrayPattern(id)) {
    const first = id.elements[0]
    if (first !== undefined && first !== null && isIdentifier(first)) {
      addBinding(state, first.name, binding)
    }

    return
  }

  if (isObjectPattern(id)) {
    for (const property of id.properties) {
      if (!isProperty(property)) {
        continue
      }

      if (
        isIdentifier(property.key)
        && property.key.name === 't'
        && isIdentifier(property.value)
      ) {
        addBinding(state, property.value.name, binding)
      }
    }
  }
}

function collectStringMap(state: ScanState, id: { name: string }, init: unknown): void {
  const expression = unwrapTypeExpression(init)

  const values = collectStaticStringValues(expression)

  if (values.length > 0) {
    state.stringMaps.set(id.name, values)
  }

  const staticValue = evaluateStaticString(expression)
  if (staticValue !== undefined) {
    state.staticStringBindings.set(id.name, [ staticValue ])
  }

  collectPropertyStringValues(expression, state)
}

function collectStaticStringValues(node: unknown): string[] {
  const expression = unwrapTypeExpression(node)
  if (isLiteralString(expression)) {
    return [ expression.value ]
  }

  if (isArrayExpression(expression)) {
    return expression.elements.flatMap(element => element === null ? [] : collectStaticStringValues(element))
  }

  if (isObjectExpression(expression)) {
    return expression.properties.flatMap(property => {
      if (!isProperty(property)) {
        return []
      }

      return collectStaticStringValues(property.value)
    })
  }

  return []
}

function collectPropertyStringValues(node: unknown, state: ScanState): void {
  const expression = unwrapTypeExpression(node)

  if (isArrayExpression(expression)) {
    for (const element of expression.elements) {
      if (element !== null) {
        collectPropertyStringValues(element, state)
      }
    }

    return
  }

  if (!isObjectExpression(expression)) {
    return
  }

  for (const property of expression.properties) {
    if (!isProperty(property)) {
      continue
    }

    const propertyName = getPropertyName(property.key)
    if (propertyName !== undefined) {
      const value = evaluateStaticString(property.value)
      if (value !== undefined) {
        addStringMapValue(state.propertyStringMaps, propertyName, value)
      }
    }

    collectPropertyStringValues(property.value, state)
  }
}

function addStringMapValue(map: Map<string, string[]>, key: string, value: string): void {
  const values = map.get(key) ?? []
  if (!values.includes(value)) {
    values.push(value)
  }

  map.set(key, values)
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

function resolveStringMapUsage(
  node: unknown,
  binding: TBinding,
  state: ScanState,
  position: { file: string; line: number; column: number }
): boolean {
  const expression = unwrapTypeExpression(node)

  if (isIdentifier(expression)) {
    const values = resolveStringBinding(state, expression.name)
      ?? state.stringMaps.get(expression.name)
    if (values === undefined) {
      return false
    }

    for (const value of values) {
      recordUsage(value, binding, state, position)
    }

    return true
  }

  if (!isMemberExpression(expression) || !isIdentifier(expression.object)) {
    return false
  }

  const propertyName = getPropertyName(expression.property)
  const values = state.stringMaps.get(expression.object.name)
    ?? (propertyName === undefined ? undefined : resolvePropertyStringValues(state, propertyName))
  if (values === undefined) {
    return false
  }

  for (const value of values) {
    recordUsage(value, binding, state, position)
  }

  return true
}

function resolveStringBinding(state: ScanState, name: string): string[] | undefined {
  for (let index = state.scopes.length - 1; index >= 0; index--) {
    const scope = state.scopes[index]
    const values = scope?.stringBindings.get(name)
    if (values !== undefined) {
      return values
    }
  }

  return state.staticStringBindings.get(name)
}

function resolvePropertyStringValues(state: ScanState, name: string): string[] | undefined {
  const values = [
    ...(state.propertyStringMaps.get(name) ?? []),
    ...(state.crossFile.propertyStringMaps.get(name) ?? [])
  ]

  return values.length > 0 ? [ ...new Set(values) ] : undefined
}

function extractWrapperBinding(node: unknown, state: ScanState): TBinding | undefined {
  const wrapper = unwrapFunction(node)
  if (wrapper === undefined) {
    return undefined
  }

  const parameterNames = getParameterNames(wrapper.params)
  if (parameterNames.size === 0) {
    return undefined
  }

  const wrapperCalls: unknown[] = []
  const binding = findWrapperBinding(wrapper.body, state, parameterNames, wrapperCalls)

  for (const call of wrapperCalls) {
    state.ignoredCalls.add(call)
  }

  return binding
}

function unwrapFunction(node: unknown): { body: unknown; params: unknown[] } | undefined {
  if (isArrowFunctionExpression(node) || isFunctionExpression(node)) {
    const functionNode = node as Record<string, unknown>

    return {
      body: functionNode.body,
      params: Array.isArray(functionNode.params) ? functionNode.params : []
    }
  }

  if (isCallExpression(node)) {
    const firstArgument = node.arguments[0]

    if (firstArgument !== undefined) {
      return unwrapFunction(firstArgument)
    }
  }

  return undefined
}

function getParameterNames(parameters: unknown[]): Set<string> {
  const names = new Set<string>()

  for (const parameter of parameters) {
    const expression = unwrapTypeExpression(parameter)
    if (isIdentifier(expression)) {
      names.add(expression.name)
    }
  }

  return names
}

function findWrapperBinding(
  node: unknown,
  state: ScanState,
  parameterNames: Set<string>,
  wrapperCalls: unknown[]
): TBinding | undefined {
  if (node === null || node === undefined) {
    return undefined
  }

  if (isCallExpression(node)) {
    const binding = resolveTCallBinding(node.callee, state)
    if (binding !== undefined && containsParameterReference(node.arguments[0], parameterNames)) {
      if (!hasStaticallyKnownKey(node.arguments[0], state)) {
        wrapperCalls.push(node)
      }

      return binding
    }
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      const binding = findWrapperBinding(item, state, parameterNames, wrapperCalls)
      if (binding !== undefined) {
        return binding
      }
    }

    return undefined
  }

  if (isRecord(node)) {
    for (const value of Object.values(node)) {
      const binding = findWrapperBinding(value, state, parameterNames, wrapperCalls)
      if (binding !== undefined) {
        return binding
      }
    }
  }

  return undefined
}

function hasStaticallyKnownKey(node: unknown, state: ScanState): boolean {
  if (evaluateKeyArgument(node).length > 0) {
    return true
  }

  const expression = unwrapTypeExpression(node)

  if (isIdentifier(expression)) {
    return resolveStringBinding(state, expression.name) !== undefined || state.stringMaps.has(expression.name)
  }

  if (!isMemberExpression(expression) || !isIdentifier(expression.object)) {
    return false
  }

  const propertyName = getPropertyName(expression.property)

  return state.stringMaps.has(expression.object.name)
    || (propertyName !== undefined && resolvePropertyStringValues(state, propertyName) !== undefined)
}

function containsParameterReference(node: unknown, parameterNames: Set<string>): boolean {
  const expression = unwrapTypeExpression(node)
  if (isIdentifier(expression)) {
    return parameterNames.has(expression.name)
  }

  if (Array.isArray(expression)) {
    return expression.some(item => containsParameterReference(item, parameterNames))
  }

  if (isRecord(expression)) {
    return Object.values(expression).some(value => containsParameterReference(value, parameterNames))
  }

  return false
}

function resolveTCallBinding(callee: unknown, state: ScanState): TBinding | undefined {
  if (isIdentifier(callee)) {
    return resolveBinding(state, callee.name)
  }

  if (
    isMemberExpression(callee)
    && isIdentifier(callee.object)
    && isIdentifier(callee.property)
    && callee.property.name === 't'
    && state.defaultI18nextNames.has(callee.object.name)
  ) {
    return { namespace: state.config.defaultNS }
  }

  return undefined
}

function handleCallExpression(node: unknown, state: ScanState): void {
  if (!isCallExpression(node)) {
    return
  }

  if (state.ignoredCalls.has(node)) {
    return
  }

  const callee = node.callee
  const position = extractPosition(node, state)

  if (
    isMemberExpression(callee)
    && isIdentifier(callee.object)
    && state.defaultI18nextNames.has(callee.object.name)
    && isIdentifier(callee.property)
    && callee.property.name === 't'
  ) {
    const binding = extractTBinding(node.arguments[1], state.config.defaultNS)

    extractUsageFromArgs(node.arguments[0], binding, state, position)

    return
  }

  if (isIdentifier(callee)) {
    const binding = resolveBinding(state, callee.name)
    if (binding !== undefined) {
      extractUsageFromArgs(node.arguments[0], binding, state, position)
    }
  }
}

function handleJSXElement(node: unknown, state: ScanState): void {
  if (!isJSXElement(node)) {
    return
  }

  const opening = node.openingElement
  if (!isRecord(opening)) {
    return
  }

  const name = opening.name
  if (!isJSXIdentifier(name) || !state.transComponentNames.has(name.name)) {
    return
  }

  const attributes = opening.attributes
  if (!Array.isArray(attributes)) {
    return
  }

  let i18nKey: string | undefined
  let i18nKeyNode: unknown
  let namespace = state.config.defaultNS

  for (const attr of attributes) {
    if (!isJSXAttribute(attr)) {
      continue
    }

    const attrName = attr.name
    if (!isRecord(attrName) || typeof attrName.name !== 'string') {
      continue
    }

    const attrValue = attr.value

    if (attrName.name === 'i18nKey') {
      i18nKeyNode = attrValue
      if (isLiteralString(attrValue)) {
        i18nKey = attrValue.value
      }
    }

    if (attrName.name === 'ns' && isLiteralString(attrValue)) {
      namespace = attrValue.value
    }
  }

  const position = extractPosition(node, state)

  if (i18nKeyNode === undefined) {
    state.usages.push({
      type: 'ambiguous',
      namespace,
      reason: '<Trans> without i18nKey',
      ...position
    })
  } else if (i18nKey === undefined) {
    extractUsageFromArgs(i18nKeyNode, { namespace }, state, position)
  } else {
    recordUsage(i18nKey, { namespace }, state, position)
  }
}

function extractUsageFromArgs(
  node: unknown,
  binding: TBinding,
  state: ScanState,
  position: { file: string; line: number; column: number }
): void {
  const evaluated = evaluateKeyArgument(node)

  if (evaluated.length === 0) {
    if (resolveStringMapUsage(node, binding, state, position)) {
      return
    }

    state.usages.push({
      type: 'pattern',
      namespace: binding.namespace,
      prefix: withKeyPrefix('', binding.keyPrefix),
      suffix: '',
      pattern: `${withKeyPrefix('', binding.keyPrefix)}*`,
      ...position
    })

    return
  }

  for (const arg of evaluated) {
    if (arg.type === 'static') {
      recordUsage(arg.value, binding, state, position)

      continue
    }

    state.usages.push({
      type: 'pattern',
      namespace: arg.namespace ?? binding.namespace,
      prefix: withKeyPrefix(arg.prefix, binding.keyPrefix),
      suffix: arg.suffix,
      pattern: `${withKeyPrefix(arg.prefix, binding.keyPrefix)}*${arg.suffix === '' ? '' : arg.suffix}`,
      ...position
    })
  }
}

function recordUsage(
  fullKey: string,
  binding: TBinding,
  state: ScanState,
  position: { file: string; line: number; column: number }
): void {
  const { namespace, key: rawKey } = splitNamespaceKey(fullKey, binding.namespace, state.config.nsSeparator)
  const key = withKeyPrefix(rawKey, binding.keyPrefix)
  state.usages.push({
    type: 'static',
    namespace,
    key,
    full: `${namespace}:${key}`,
    ...position
  })
}

type KeyArgument
  = | { type: 'static'; value: string }
  | { type: 'pattern'; prefix: string; suffix: string; namespace?: string }

function evaluateKeyArgument(node: unknown): KeyArgument[] {
  const expression = unwrapTypeExpression(node)

  if (expression === null || expression === undefined) {
    return []
  }

  if (isLiteralString(expression)) {
    return [{ type: 'static', value: expression.value }]
  }

  if (isTemplateLiteral(expression)) {
    const strings = expression.quasis.map(item => getTemplateElementValue(item) ?? '')

    if (strings.length === 0) {
      return []
    }

    if (expression.expressions.length === 0) {
      return [{ type: 'static', value: strings.join('') }]
    }

    const prefix = strings.at(0) ?? ''
    const suffix = strings.at(-1) ?? ''

    return [{ type: 'pattern', prefix, suffix }]
  }

  if (isConditionalExpression(expression)) {
    return [
      ...evaluateKeyArgument(expression.consequent),
      ...evaluateKeyArgument(expression.alternate)
    ]
  }

  if (isBinaryExpression(expression) && expression.operator === '+') {
    const left = evaluateStaticString(expression.left)
    const right = evaluateStaticString(expression.right)

    if (left !== undefined && right !== undefined) {
      return [{ type: 'static', value: left + right }]
    }

    if (left !== undefined) {
      return [{ type: 'pattern', prefix: left, suffix: '' }]
    }

    if (right !== undefined) {
      return [{ type: 'pattern', prefix: '', suffix: right }]
    }
  }

  return []
}

function evaluateStaticString(node: unknown): string | undefined {
  const expression = unwrapTypeExpression(node)

  if (isLiteralString(expression)) {
    return expression.value
  }

  if (isTemplateLiteral(expression) && expression.expressions.length === 0) {
    return expression.quasis.map(item => getTemplateElementValue(item) ?? '').join('')
  }

  return undefined
}

function getTemplateElementValue(node: unknown): string | undefined {
  if (!isRecord(node)) {
    return undefined
  }

  const value = node.value
  if (!isRecord(value)) {
    return undefined
  }

  if (isString(value.cooked)) {
    return value.cooked
  }

  if (isString(value.raw)) {
    return value.raw
  }

  return undefined
}

function extractBindingFromHook(node: unknown, state: ScanState): TBinding | undefined {
  if (!isCallExpression(node)) {
    return undefined
  }

  const callee = node.callee
  if (!isIdentifier(callee)) {
    return undefined
  }

  if (!state.useTranslationNames.has(callee.name) && !state.getFixedTNames.has(callee.name)) {
    return undefined
  }

  const firstArg = node.arguments[0]
  const namespace = isLiteralString(firstArg) ? firstArg.value : state.config.defaultNS
  const options = isLiteralString(firstArg) ? node.arguments[1] : firstArg

  return { namespace, keyPrefix: extractKeyPrefix(options) }
}

function extractTBinding(node: unknown, defaultNS: string): TBinding {
  return {
    namespace: extractNsOption(node, defaultNS),
    keyPrefix: extractKeyPrefix(node)
  }
}

function extractNsOption(node: unknown, defaultNS: string): string {
  if (!isObjectExpression(node)) {
    return defaultNS
  }

  for (const property of node.properties) {
    if (!isProperty(property)) {
      continue
    }

    if (!isIdentifier(property.key) || property.key.name !== 'ns') {
      continue
    }

    const value = property.value
    if (isLiteralString(value)) {
      return value.value
    }
  }

  return defaultNS
}

function extractKeyPrefix(node: unknown): string | undefined {
  if (!isObjectExpression(node)) {
    return undefined
  }

  for (const property of node.properties) {
    if (!isProperty(property) || !isIdentifier(property.key) || property.key.name !== 'keyPrefix') {
      continue
    }

    if (isLiteralString(property.value)) {
      return property.value.value
    }
  }

  return undefined
}

function withKeyPrefix(key: string, keyPrefix: string | undefined): string {
  if (keyPrefix === undefined || keyPrefix.length === 0) {
    return key
  }

  if (key.length === 0) {
    return `${keyPrefix}.`
  }

  return `${keyPrefix}.${key}`
}

function buildLineStarts(source: string): number[] {
  const starts: number[] = [ 0 ]

  // oxlint-disable-next-line typescript/no-misused-spread
  for (const [ index, char ] of [ ...source ].entries()) {
    if (char === '\n') {
      starts.push(index + 1)
    }
  }

  return starts
}

function offsetToPosition(lineStarts: number[], offset: number): { line: number; column: number } {
  let low = 0
  let high = lineStarts.length - 1

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)

    if ((lineStarts[middle] ?? 0) <= offset) {
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  const line = high >= 0 ? high + 1 : 1
  const lineStart = lineStarts[high] ?? 0
  const column = offset - lineStart + 1

  return { line, column: Math.max(column, 1) }
}

function extractPosition(node: unknown, state: Pick<ScanState, 'file' | 'lineStarts'>): { file: string; line: number; column: number } {
  const offset = isRecord(node) && typeof node.start === 'number' ? node.start : 0

  return {
    file: state.file,
    ...offsetToPosition(state.lineStarts, offset)
  }
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}
