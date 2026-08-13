import type { StaticImportEntry } from 'oxc-parser'


export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

export function isIdentifier(node: unknown): node is { name: string } {
  return isRecord(node) && node.type === 'Identifier' && typeof node.name === 'string'
}

export function isJSXIdentifier(node: unknown): node is { name: string } {
  return isRecord(node) && node.type === 'JSXIdentifier' && typeof node.name === 'string'
}

export function isCallExpression(node: unknown): node is { callee: unknown; arguments: unknown[]; loc?: unknown } {
  return isRecord(node) && node.type === 'CallExpression'
}

export function isObjectExpression(node: unknown): node is { properties: unknown[] } {
  return isRecord(node) && node.type === 'ObjectExpression'
}

export function isArrayExpression(node: unknown): node is { elements: unknown[] } {
  return isRecord(node) && node.type === 'ArrayExpression'
}

export function isTemplateLiteral(node: unknown): node is { quasis: unknown[]; expressions: unknown[] } {
  return isRecord(node) && node.type === 'TemplateLiteral'
}

export function isLiteralString(node: unknown): node is { value: string } {
  return isRecord(node) && node.type === 'Literal' && typeof node.value === 'string'
}

export function isProperty(node: unknown): node is { key: unknown; value: unknown } {
  return isRecord(node) && node.type === 'Property'
}

export function isMemberExpression(node: unknown): node is { object: unknown; property: unknown } {
  return isRecord(node) && node.type === 'MemberExpression'
}

export function isJSXAttribute(node: unknown): node is { name: { name?: unknown }; value: unknown } {
  return isRecord(node) && node.type === 'JSXAttribute'
}

export function isJSXElement(node: unknown): node is { openingElement: { name?: unknown; attributes?: unknown[] } } {
  return isRecord(node) && node.type === 'JSXElement'
}

export function isVariableDeclarator(node: unknown): node is { id?: unknown; init?: unknown } {
  return isRecord(node) && node.type === 'VariableDeclarator'
}

export function isVariableDeclaration(node: unknown): node is { kind: string; declarations: unknown[] } {
  return isRecord(node) && node.type === 'VariableDeclaration' && typeof node.kind === 'string' && Array.isArray(node.declarations)
}

export function isExportNamedDeclaration(node: unknown): node is { declaration?: unknown } {
  return isRecord(node) && node.type === 'ExportNamedDeclaration'
}

export function isArrayPattern(node: unknown): node is { elements: unknown[] } {
  return isRecord(node) && node.type === 'ArrayPattern'
}

export function isObjectPattern(node: unknown): node is { properties: unknown[] } {
  return isRecord(node) && node.type === 'ObjectPattern'
}

export function isExportDefaultDeclaration(node: unknown): node is { declaration?: unknown } {
  return isRecord(node) && node.type === 'ExportDefaultDeclaration'
}

export function isConditionalExpression(node: unknown): node is { consequent: unknown; alternate: unknown } {
  return isRecord(node) && node.type === 'ConditionalExpression'
}

export function isBinaryExpression(node: unknown): node is { left: unknown; right: unknown; operator: string } {
  return isRecord(node) && node.type === 'BinaryExpression' && typeof node.operator === 'string'
}

export function isArrowFunctionExpression(node: unknown): node is { body: unknown } {
  return isRecord(node) && node.type === 'ArrowFunctionExpression'
}

export function isFunctionExpression(node: unknown): node is { body: unknown } {
  return isRecord(node) && node.type === 'FunctionExpression'
}

export function isFunctionDeclaration(node: unknown): node is { body: unknown } {
  return isRecord(node) && node.type === 'FunctionDeclaration'
}

export function isBlockStatement(node: unknown): node is { body: unknown[] } {
  return isRecord(node) && node.type === 'BlockStatement' && Array.isArray(node.body)
}

export function getImportedName(entry: StaticImportEntry): string | undefined {
  // oxlint-disable-next-line typescript/no-unsafe-enum-comparison
  if (entry.importName.kind === 'Default') {
    return 'default'
  }

  return entry.importName.name ?? undefined
}
