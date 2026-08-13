import { dirname, resolve } from 'node:path'
import { parseSync, Visitor } from 'oxc-parser'
import { diagnostics } from './diagnostics'
import type { ExtractedConfig, LocaleSource } from './types'
import {
  isArrayExpression,
  isCallExpression,
  isExportNamedDeclaration,
  isIdentifier,
  isLiteralString,
  isObjectExpression,
  isProperty,
  isRecord,
  isString,
  isVariableDeclaration,
  isVariableDeclarator
} from './type-guards'
import { readText } from './utils'


const LEADING_SLASH_REGEX = /^\//u
const TRAILING_SLASH_REGEX = /\/$/u


export function parseInitConfig(initFile: string): ExtractedConfig {
  const source = readText(initFile)
  const result = parseSync(initFile, source)

  const localNames = new Set<string>()
  const defaultNames: string[] = []

  for (const item of result.module.staticImports) {
    const moduleSource = item.moduleRequest.value
    if (moduleSource !== 'i18next' && moduleSource !== 'react-i18next') {
      continue
    }

    for (const entry of item.entries) {
      const localName = entry.localName.value
      localNames.add(localName)
      // oxlint-disable-next-line typescript/no-unsafe-enum-comparison
      if (entry.importName.kind === 'Default') {
        defaultNames.push(localName)
      }
    }
  }

  const program = result.program

  let configObject: Record<string, unknown> | undefined

  const visitor = new Visitor({
    CallExpression(node) {
      const object = extractInitObject(node, localNames, defaultNames, program)
      if (object !== undefined && configObject === undefined) {
        configObject = object
      }
    }
  })

  visitor.visit(program)

  if (configObject === undefined) {
    throw diagnostics.I18V_1004({ sources: [ initFile ] })
  }

  return extractFromObject(configObject, initFile, program)
}

function extractInitObject(
  node: unknown,
  localNames: Set<string>,
  defaultNames: string[],
  program: unknown
): Record<string, unknown> | undefined {
  if (!isCallExpression(node)) {
    return undefined
  }

  const callee = node.callee

  if (isMemberExpression(callee)) {
    if (!isInitCall(callee)) {
      return undefined
    }
  } else if (isIdentifier(callee)) {
    if (callee.name === 'init' && localNames.has(callee.name)) {
      // named import: init({ ... })
    } else if (!(callee.name === 'createInstance' && defaultNames.includes(callee.name))) {
      return undefined
    }
  } else {
    return undefined
  }

  if (node.arguments.length === 0) {
    return undefined
  }

  return evaluateObjectLiteral(node.arguments[0], program)

  function isInitCall(member: { object: unknown; property: unknown }): boolean {
    if (
      isIdentifier(member.property)
      && member.property.name === 'init'
    ) {
      if (isIdentifier(member.object) && localNames.has(member.object.name)) {
        return true
      }

      // chained .use().init()
      if (isCallExpression(member.object)) {
        const chainedCallee = member.object.callee
        if (
          isMemberExpression(chainedCallee)
          && isIdentifier(chainedCallee.object)
          && localNames.has(chainedCallee.object.name)
          && isIdentifier(chainedCallee.property)
          && chainedCallee.property.name === 'use'
        ) {
          return true
        }
      }
    }

    return false
  }
}

function isMemberExpression(node: unknown): node is { object: unknown; property: unknown } {
  return isRecord(node) && node.type === 'MemberExpression'
}

function resolveIdentifier(name: string, program: unknown): unknown {
  if (!isRecord(program) || !Array.isArray(program.body)) {
    return undefined
  }

  for (const statement of program.body) {
    const declarator = findDeclarator(statement, name)
    if (declarator?.init !== undefined) {
      return evaluateStatic(declarator.init, program)
    }
  }

  return undefined
}

function findDeclarator(node: unknown, name: string): { init?: unknown } | undefined {
  if (isExportNamedDeclaration(node)) {
    return findDeclarator(node.declaration, name)
  }

  if (!isVariableDeclaration(node)) {
    return undefined
  }

  for (const declarator of node.declarations) {
    if (isVariableDeclarator(declarator) && isIdentifier(declarator.id) && declarator.id.name === name) {
      return declarator
    }
  }

  return undefined
}

function evaluateObjectLiteral(
  node: unknown,
  program: unknown
): Record<string, unknown> | undefined {
  if (!isObjectExpression(node)) {
    return undefined
  }

  const result: Record<string, unknown> = {}

  for (const property of node.properties) {
    if (!isProperty(property)) {
      continue
    }

    const keyName = getPropertyKeyName(property.key)
    if (keyName === undefined) {
      continue
    }

    const evaluated = evaluateStatic(property.value, program)
    if (evaluated !== undefined) {
      result[keyName] = evaluated
    }
  }

  return result
}

function evaluateStatic(node: unknown, program: unknown): unknown {
  if (isLiteralString(node)) {
    return node.value
  }

  if (isIdentifier(node)) {
    return resolveIdentifier(node.name, program)
  }

  if (isArrayExpression(node)) {
    return node.elements
      .map(element => (element === null ? undefined : evaluateStatic(element, program)))
      .filter((value): value is unknown => value !== undefined)
  }

  if (isObjectExpression(node)) {
    return evaluateObjectLiteral(node, program)
  }

  const stringCall = evaluateStringCall(node, program)
  if (stringCall !== undefined) {
    return stringCall
  }

  return undefined
}

function evaluateStringCall(node: unknown, program: unknown): string | undefined {
  if (!isCallExpression(node)) {
    return undefined
  }

  const callee = node.callee
  if (!isMemberExpression(callee) || !isIdentifier(callee.property)) {
    return undefined
  }

  const objectValue = evaluateStatic(callee.object, program)
  if (!isString(objectValue)) {
    return undefined
  }

  const args = node.arguments.map(argument => evaluateStatic(argument, program))
  const method = callee.property.name

  if (method === 'replaceAll' && args.length >= 2) {
    const search = args[0]
    const replacement = args[1]

    if (isString(search) && isString(replacement)) {
      return objectValue.replaceAll(search, replacement)
    }
  }

  if (method === 'replace' && args.length >= 2) {
    const search = args[0]
    const replacement = args[1]

    if (isString(search) && isString(replacement)) {
      return objectValue.replace(search, replacement)
    }
  }

  return undefined
}

function getPropertyKeyName(node: unknown): string | undefined {
  if (isIdentifier(node)) {
    return node.name
  }

  if (isLiteralString(node)) {
    return node.value
  }

  return undefined
}

function extractFromObject(
  config: Record<string, unknown>,
  initFile: string,
  program: unknown
): ExtractedConfig {
  const defaultNS = getString(config, 'defaultNS')
  const nsSeparator = getString(config, 'nsSeparator') ?? ':'
  const keySeparator = getString(config, 'keySeparator') ?? '.'
  const fallbackNS = getStringOrArray(config, 'fallbackNS')
  const preloadNS = getStringOrArray(config, 'ns')

  const interpolationObject = getRecord(config, 'interpolation')
  const interpolation = {
    prefix: getString(interpolationObject, 'prefix') ?? '{{',
    suffix: getString(interpolationObject, 'suffix') ?? '}}'
  }

  const localeSources: LocaleSource[] = []

  const resources = getRecord(config, 'resources')
  if (resources !== undefined) {
    localeSources.push(...extractInlineResources(resources, initFile))
  }

  const backend = getRecord(config, 'backend')
  const loadPathNode = backend?.loadPath
  if (loadPathNode !== undefined) {
    const loadPath = evaluateLoadPath(loadPathNode, program)
    if (loadPath !== undefined) {
      const directorySource = resolveLoadPathDirectory(loadPath, initFile)
      if (directorySource !== undefined) {
        localeSources.push(directorySource)
      }
    }
  }

  return {
    defaultNS,
    nsSeparator,
    keySeparator,
    fallbackNS,
    preloadNS,
    interpolation,
    localeSources
  }
}

function evaluateLoadPath(node: unknown, program: unknown): string | undefined {
  const evaluated = evaluateStatic(node, program)

  if (isString(evaluated) && evaluated.includes('{{lng}}') && evaluated.includes('{{ns}}')) {
    return evaluated
  }

  const literal = findPlaceholderLiteral(node)
  if (literal !== undefined) {
    return literal
  }

  if (isString(evaluated)) {
    return evaluated
  }

  return undefined
}

function findPlaceholderLiteral(node: unknown): string | undefined {
  if (isLiteralString(node)) {
    const value = node.value

    return value.includes('{{lng}}') && value.includes('{{ns}}') ? value : undefined
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findPlaceholderLiteral(item)

      if (found !== undefined) {
        return found
      }
    }

    return undefined
  }

  if (isRecord(node)) {
    for (const value of Object.values(node)) {
      const found = findPlaceholderLiteral(value)

      if (found !== undefined) {
        return found
      }
    }
  }

  return undefined
}

function extractInlineResources(
  resources: Record<string, unknown>,
  initFile: string
): LocaleSource[] {
  const sources: LocaleSource[] = []

  for (const [ language, namespaces ] of Object.entries(resources)) {
    if (!isRecord(namespaces)) {
      continue
    }

    for (const [ namespace, data ] of Object.entries(namespaces)) {
      if (!isRecord(data)) {
        continue
      }

      sources.push({
        type: 'inline',
        path: initFile,
        namespace,
        language,
        data
      })
    }
  }

  return sources
}

function resolveLoadPathDirectory(loadPath: string, initFile: string): LocaleSource | undefined {
  const normalized = loadPath.replace(LEADING_SLASH_REGEX, '')
  const lngIndex = normalized.indexOf('{{lng}}')
  if (lngIndex === -1) {
    return undefined
  }

  let directory = normalized.slice(0, lngIndex).replace(TRAILING_SLASH_REGEX, '')
  if (directory === '') {
    directory = '.'
  }

  const absolute = resolve(dirname(initFile), directory)

  return { type: 'directory', path: absolute }
}

function getString(object: Record<string, unknown> | undefined, key: string): string | undefined {
  if (object === undefined) {
    return undefined
  }

  const value = object[key]

  return isString(value) ? value : undefined
}

function getStringOrArray(object: Record<string, unknown>, key: string): string[] {
  const value = object[key]
  if (isString(value)) {
    return [ value ]
  }

  if (Array.isArray(value)) {
    return value.filter(item => isString(item))
  }

  return []
}

function getRecord(object: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  if (object === undefined) {
    return undefined
  }

  const value = object[key]

  return isRecord(value) ? value : undefined
}
