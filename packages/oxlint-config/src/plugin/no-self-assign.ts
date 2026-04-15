import type { Rule, Scope, SourceCode } from 'eslint'


/*
 * Ported from:
 * https://github.com/DaniFoldi/bundled-lint-config/blob/main/packages/bundled-eslint-config/src/rules/no-self-assign.ts
 *
 * Includes code derived from MIT-licensed source.
 * Copyright (c) 2026 Dániel Földi
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 */

type ScopeNode = Parameters<SourceCode['getScope']>[0]
type IdentifierNode = ScopeNode & { type: 'Identifier'; name: string }
type AssignmentPatternNode = ScopeNode & {
  type: 'AssignmentPattern'
  left: ScopeNode
  right: ScopeNode
}
type FunctionLikeNode = ScopeNode & {
  type: 'ArrowFunctionExpression' | 'FunctionDeclaration' | 'FunctionExpression'
  params: readonly ScopeNode[]
}

function isIdentifier(node: { type: string } | ScopeNode): node is IdentifierNode {
  return node.type === 'Identifier'
}

function isAssignmentPattern(node: ScopeNode): node is AssignmentPatternNode {
  return node.type === 'AssignmentPattern'
}

function isFunctionLike(node: ScopeNode): node is FunctionLikeNode {
  return node.type === 'FunctionExpression'
    || node.type === 'FunctionDeclaration'
    || node.type === 'ArrowFunctionExpression'
}

function isNode(value: unknown): value is ScopeNode {
  return typeof value === 'object'
    && value !== null
    && typeof Reflect.get(value, 'type') === 'string'
}

function getProperty(value: object, key: PropertyKey): unknown {
  return Reflect.get(value, key)
}

function getParent(node: ScopeNode, sourceCode: SourceCode) {
  return sourceCode.getAncestors(node).at(-1)
}

function traverseNodes(
  node: ScopeNode,
  sourceCode: SourceCode,
  visitor: (child: ScopeNode) => void,
  shouldSkipChildren?: (child: ScopeNode) => boolean
): void {
  visitor(node)

  if (shouldSkipChildren?.(node) === true) {
    return
  }

  const keys = sourceCode.visitorKeys[node.type] ?? []

  for (const key of keys) {
    const value = getProperty(node, key)

    if (Array.isArray(value)) {
      for (const child of value) {
        if (isNode(child)) {
          traverseNodes(child, sourceCode, visitor, shouldSkipChildren)
        }
      }
    } else if (isNode(value)) {
      traverseNodes(value, sourceCode, visitor, shouldSkipChildren)
    }
  }
}

function isReferenceIdentifier(identifier: IdentifierNode, sourceCode: SourceCode): boolean {
  const parent = getParent(identifier, sourceCode)
  if (!parent) {
    return true
  }

  if (parent.type.startsWith('TS')) {
    return false
  }

  if (parent.type === 'Property' && parent.key === identifier) {
    return parent.computed || parent.shorthand
  }

  if (parent.type === 'MemberExpression' && parent.property === identifier) {
    return parent.computed
  }

  if (
    (parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition')
    && parent.key === identifier
    && !parent.computed
  ) {
    return false
  }

  if (
    parent.type === 'ImportSpecifier'
    || parent.type === 'ImportDefaultSpecifier'
    || parent.type === 'ImportNamespaceSpecifier'
  ) {
    return false
  }

  if (parent.type === 'ExportSpecifier' && parent.exported === identifier) {
    return false
  }

  if (parent.type === 'LabeledStatement' && parent.label === identifier) {
    return false
  }

  return true
}

function findVariable(node: ScopeNode, name: string, sourceCode: SourceCode): Scope.Variable | null {
  let scope: Scope.Scope | null = sourceCode.getScope(node)

  while (scope) {
    const variable = scope.set.get(name)
    if (variable) {
      return variable
    }

    scope = scope.upper
  }

  return null
}

function isSelfReference(identifier: IdentifierNode, variable: Scope.Variable, sourceCode: SourceCode): boolean {
  if (variable.references.some(reference => reference.identifier === identifier)) {
    return true
  }

  let scope: Scope.Scope | null = sourceCode.getScope(identifier)

  while (scope) {
    const reference = scope.references.find(candidate => candidate.identifier === identifier)
    if (reference) {
      return reference.resolved === variable
    }

    scope = scope.upper
  }

  scope = sourceCode.getScope(identifier)

  while (scope) {
    const candidate = scope.set.get(identifier.name)
    if (candidate) {
      return candidate === variable
    }

    scope = scope.upper
  }

  for (const ancestor of sourceCode.getAncestors(identifier).toReversed()) {
    if (!isAssignmentPattern(ancestor)) {
      continue
    }

    if (
      isIdentifier(ancestor.left)
      && ancestor.left.name === variable.name
      && variable.defs.some(definition => definition.name === ancestor.left)
    ) {
      return true
    }
  }

  return false
}

function isUnresolvedSelfReference(identifier: IdentifierNode, name: string, sourceCode: SourceCode): boolean {
  if (identifier.name !== name) {
    return false
  }

  return findVariable(identifier, name, sourceCode) === null
}

function reportSelfReferences(
  context: Rule.RuleContext,
  sourceCode: SourceCode,
  node: ScopeNode,
  variable: Scope.Variable
): void {
  traverseNodes(node, sourceCode, child => {
    if (!isIdentifier(child)) {
      return
    }

    if (!isReferenceIdentifier(child, sourceCode)) {
      return
    }

    if (isSelfReference(child, variable, sourceCode)) {
      context.report({
        node: child,
        messageId: 'selfRef',
        data: { name: variable.name }
      })
    }
  }, isFunctionLike)
}

function reportSelfReferencesByName(
  context: Rule.RuleContext,
  sourceCode: SourceCode,
  node: ScopeNode,
  name: string
): void {
  traverseNodes(node, sourceCode, child => {
    if (!isIdentifier(child)) {
      return
    }

    if (!isReferenceIdentifier(child, sourceCode)) {
      return
    }

    if (isUnresolvedSelfReference(child, name, sourceCode)) {
      context.report({
        node: child,
        messageId: 'selfRef',
        data: { name }
      })
    }
  }, isFunctionLike)
}

function reportDefaultParameterSelfReferences(
  context: Rule.RuleContext,
  sourceCode: SourceCode,
  node: FunctionLikeNode
): void {
  for (const param of node.params) {
    if (!isAssignmentPattern(param) || !isIdentifier(param.left)) {
      continue
    }

    const variable = findVariable(param.left, param.left.name, sourceCode)
    if (!variable) {
      continue
    }

    reportSelfReferences(context, sourceCode, param.right, variable)
  }
}

export const noSelfAssign: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow self-references inside variable initializers and parameter default values'
    },
    schema: [],
    messages: {
      selfRef: 'Variable {{name}} is referenced within its own initializer.'
    }
  },

  create(context) {
    const sourceCode = context.sourceCode

    return {
      VariableDeclarator(node) {
        if (!node.init || !isIdentifier(node.id)) {
          return
        }

        const variable = findVariable(node, node.id.name, sourceCode)
        if (!variable) {
          return
        }

        reportSelfReferences(context, sourceCode, node.init, variable)
      },

      FunctionDeclaration(node) {
        reportDefaultParameterSelfReferences(context, sourceCode, node)
      },

      FunctionExpression(node) {
        reportDefaultParameterSelfReferences(context, sourceCode, node)
      },

      ArrowFunctionExpression(node) {
        reportDefaultParameterSelfReferences(context, sourceCode, node)
      },

      PropertyDefinition(node) {
        if (!node.value || !isIdentifier(node.key)) {
          return
        }

        reportSelfReferencesByName(context, sourceCode, node.value, node.key.name)
      }
    }
  }
}
