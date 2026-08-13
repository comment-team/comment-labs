/*
 * Derived from eslint-plugin-i18next
 * https://github.com/edvardchen/eslint-plugin-i18next
 *
 * Copyright (c) 2019 edvardchen
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
 * SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

// oxlint-disable typescript/no-unsafe-type-assertion
// oxlint-disable typescript/no-unnecessary-type-assertion

import type { Rule, SourceCode } from 'eslint'
import { getNearestAncestor, isAllowedDOMAttr, isUpperCase, shouldSkip, type SkipPatterns } from './helpers'
import { defaults, schema } from './options'


type Context = Rule.RuleContext

type Node = Rule.Node

type Options = Record<string, unknown>

type LooseNode = {
  type: string
  parent?: LooseNode | null
  [key: string]: unknown
}

type JSXMemberExpressionNode = LooseNode & {
  type: 'JSXMemberExpression'
  object: JSXMemberExpressionNode | JSXIdentifierNode
  property: JSXIdentifierNode
}

type JSXIdentifierNode = LooseNode & {
  type: 'JSXIdentifier'
  name: string
}

type JSXOpeningElementNode = LooseNode & {
  type: 'JSXOpeningElement'
  name: JSXIdentifierNode | JSXMemberExpressionNode
}

type JSXElementNode = LooseNode & {
  type: 'JSXElement'
  openingElement: JSXOpeningElementNode
}

type JSXAttributeNode = LooseNode & {
  type: 'JSXAttribute'
  name: JSXIdentifierNode
  value: Node | null
}

type VIdentifierNode = LooseNode & {
  type: 'VIdentifier'
  name: string
  rawName: string
}

type VDirectiveKeyNode = LooseNode & {
  type: 'VDirectiveKey'
  name: VIdentifierNode
  argument: VIdentifierNode | null
}

type VAttributeNode = LooseNode & {
  type: 'VAttribute'
  key: VDirectiveKeyNode | VIdentifierNode
  directive: boolean
}

type VElementNode = LooseNode & {
  type: 'VElement'
  rawName: string
}

function getSourceCode(context: Context): SourceCode {
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  return context.sourceCode
    ?? (context as unknown as { getSourceCode(): SourceCode }).getSourceCode()
}

function getText(context: Context, node: Node): string {
  return getSourceCode(context).getText(node as Parameters<SourceCode['getText']>[0])
}

function getAncestors(context: Context, node: Node): Node[] {
  return getSourceCode(context).getAncestors(node as Parameters<SourceCode['getAncestors']>[0]) as Node[]
}

function withDottedPrefix(patterns: readonly unknown[] = []): readonly unknown[] {
  return patterns.map(item =>
    typeof item === 'string' ? `(?:.*\\.)?${item}` : item
  )
}

function isValidFunctionCall(context: Context, options: Options, { callee }: { callee: Node }): boolean {
  if ((callee as { type: string }).type === 'Import') return true

  const sourceText = getText(context, callee)
  const callees = (options.callees as SkipPatterns | undefined) ?? {}

  return shouldSkip(
    {
      include: withDottedPrefix(callees.include),
      exclude: withDottedPrefix(callees.exclude)
    },
    sourceText
  )
}

function isValidLiteral(options: Options, { value }: { value: unknown }): boolean {
  if (typeof value !== 'string') {
    return true
  }

  const trimmed = value.trim()
  if (!trimmed) return true

  const words = (options.words as SkipPatterns | undefined) ?? {}
  return shouldSkip(words, trimmed)
}

function getAttributeName(node: VAttributeNode): string | null {
  if (!node.directive) {
    return (node.key as VIdentifierNode).rawName
  }

  const directiveKey = node.key as VDirectiveKeyNode
  if (
    (directiveKey.name.name === 'bind' || directiveKey.name.name === 'model')
    && directiveKey.argument
    && directiveKey.argument.type === 'VIdentifier'
  ) {
    return directiveKey.argument.rawName
  }

  return null
}

function resolveCallee(node: Node): Node {
  if (node.type === 'CallExpression' || node.type === 'NewExpression') {
    return node.callee as Node
  }

  if (node.type === 'TaggedTemplateExpression') {
    return node.tag as Node
  }

  return node
}

export const noLiteralString: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'disallow literal string',
      recommended: true
    },
    schema: [schema],
    messages: {
      literal: '{{message}}: {{parent}}'
    }
  },

  create(context) {
    const parserServices = (context as unknown as { parserServices?: unknown }).parserServices
      ?? ((context as unknown as { sourceCode?: { parserServices?: unknown } }).sourceCode?.parserServices)
    const userOptions = (context.options[0] as Options | undefined) ?? {}
    const options = { ...defaults, ...userOptions }

    const {
      mode: rawMode,
      'should-validate-template': validateTemplate,
      message,
      framework: rawFramework
    } = options as typeof defaults

    const mode = rawMode as string
    const framework = rawFramework as string

    const onlyValidateJSX = ['jsx-only', 'jsx-text-only'].includes(mode)
    const onlyValidateVueTemplate = framework === 'vue' && mode === 'vue-template-only'

    const indicatorStack: boolean[] = []

    function endIndicator(): void {
      indicatorStack.pop()
    }

    function isValidScope(): boolean {
      return indicatorStack.some(item => item)
    }

    function report(node: Node): void {
      context.report({
        node,
        messageId: 'literal',
        data: {
          message,
          parent: getText(context, node.parent ?? node)
        }
      })
    }

    const { esTreeNodeToTSNodeMap, program } = (parserServices as {
      esTreeNodeToTSNodeMap?: Map<Node, unknown>
      program?: { getTypeChecker(): { getContextualType(node: unknown): ContextualType | null } }
    } | undefined) ?? {}

    interface ContextualType {
      isStringLiteral(): boolean
      isUnion(): boolean
      types: Array<{ isStringLiteral(): boolean; value: unknown }>
    }

    let typeChecker: ReturnType<NonNullable<typeof program>['getTypeChecker']> | undefined
    if (program && esTreeNodeToTSNodeMap) {
      typeChecker = program.getTypeChecker()
    }

    function validateBeforeReport(node: Node & { value: unknown }): void {
      if (isValidScope()) return
      if (isValidLiteral(options as Options, node)) return

      if (typeChecker) {
        const tsNode = esTreeNodeToTSNodeMap?.get(node)
        if (tsNode) {
          const typeObj = typeChecker.getContextualType(tsNode)
          if (typeObj) {
            if (typeObj.isStringLiteral()) {
              return
            }

            if (typeObj.isUnion()) {
              const found = typeObj.types.some(item =>
                item.isStringLiteral() && item.value === node.value
              )
              if (found) return
            }
          }
        }
      }

      report(node)
    }

    function filterOutJSX(node: Node): boolean {
      if (!onlyValidateJSX) return false

      const isInsideJSX = getAncestors(context, node).some(item =>
        ['JSXElement', 'JSXFragment'].includes(item.type)
      )

      if (!isInsideJSX) return true

      if (
        mode === 'jsx-text-only'
        && !['JSXElement', 'JSXFragment'].includes(node.parent?.type ?? '')
      ) {
        return true
      }

      return false
    }

    const scriptVisitor: Rule.RuleListener = {
      ImportExpression() {
        indicatorStack.push(true)
      },
      'ImportExpression:exit': endIndicator,

      ImportDeclaration() {
        indicatorStack.push(true)
      },
      'ImportDeclaration:exit': endIndicator,

      ExportAllDeclaration() {
        indicatorStack.push(true)
      },
      'ExportAllDeclaration:exit': endIndicator,

      'ExportNamedDeclaration[source]'() {
        indicatorStack.push(true)
      },
      'ExportNamedDeclaration[source]:exit': endIndicator,

      JSXElement(node: Node) {
        const element = node as unknown as JSXElementNode
        const fullComponentName = getText(context, element.openingElement.name as unknown as Node)
        const componentOptions = (options['jsx-components'] as SkipPatterns | undefined) ?? {}
        indicatorStack.push(
          shouldSkip(
            {
              include: withDottedPrefix(componentOptions.include),
              exclude: withDottedPrefix(componentOptions.exclude)
            },
            fullComponentName
          )
        )
      },
      'JSXElement:exit': endIndicator,

      JSXAttribute(node: Node) {
        const attribute = node as unknown as JSXAttributeNode
        const attrName = attribute.name.name

        const jsxAttributes = (options['jsx-attributes'] as SkipPatterns | undefined) ?? {}
        if (shouldSkip(jsxAttributes, attrName)) {
          indicatorStack.push(true)
          return
        }

        const jsxElement = getNearestAncestor(node, 'JSXOpeningElement') as unknown as JSXOpeningElementNode
        const tagName = (jsxElement.name as JSXIdentifierNode).name
        if (isAllowedDOMAttr(tagName, attrName)) {
          indicatorStack.push(true)
          return
        }

        indicatorStack.push(false)
      },
      'JSXAttribute:exit': endIndicator,

      JSXText(node: Node) {
        validateBeforeReport(node as Node & { value: unknown })
      },

      VElement(node: Node) {
        const element = node as unknown as VElementNode
        const componentOptions = (options['jsx-components'] as SkipPatterns | undefined) ?? {}
        indicatorStack.push(
          shouldSkip(
            {
              include: withDottedPrefix(componentOptions.include),
              exclude: withDottedPrefix(componentOptions.exclude)
            },
            element.rawName
          )
        )
      },
      'VElement:exit': endIndicator,

      VAttribute(node: Node) {
        const attribute = node as unknown as VAttributeNode
        const attrName = getAttributeName(attribute)
        const jsxAttributes = (options['jsx-attributes'] as SkipPatterns | undefined) ?? {}
        indicatorStack.push(shouldSkip(jsxAttributes, attrName ?? ''))
      },
      'VAttribute:exit': endIndicator,

      TSModuleDeclaration() {
        indicatorStack.push(true)
      },
      'TSModuleDeclaration:exit': endIndicator,

      TSLiteralType() {
        indicatorStack.push(true)
      },
      'TSLiteralType:exit': endIndicator,

      TSEnumMember() {
        indicatorStack.push(true)
      },
      'TSEnumMember:exit': endIndicator,

      PropertyDefinition(node: Node) {
        const property = node as unknown as { key: { name?: string } }
        const classProperties = (options['class-properties'] as SkipPatterns | undefined) ?? {}
        indicatorStack.push(!!(property.key.name && shouldSkip(classProperties, property.key.name)))
      },
      'PropertyDefinition:exit': endIndicator,

      ClassProperty(node: Node) {
        const property = node as unknown as { key: { name?: string } }
        const classProperties = (options['class-properties'] as SkipPatterns | undefined) ?? {}
        indicatorStack.push(!!(property.key.name && shouldSkip(classProperties, property.key.name)))
      },
      'ClassProperty:exit': endIndicator,

      VariableDeclarator(node: Node) {
        const declarator = node as unknown as { id: { name?: string; type: string } }
        indicatorStack.push(declarator.id.type === 'Identifier' && isUpperCase(declarator.id.name ?? ''))
      },
      'VariableDeclarator:exit': endIndicator,

      Property(node: Node) {
        const property = node as unknown as { key: { name?: string; value?: unknown } }
        const objectProperties = (options['object-properties'] as SkipPatterns | undefined) ?? {}
        indicatorStack.push(shouldSkip(objectProperties, property.key.name ?? (property.key.value as string) ?? ''))
      },
      'Property:exit': endIndicator,

      BinaryExpression(node: Node) {
        const expression = node as unknown as { operator: string }
        indicatorStack.push(expression.operator !== '+')
      },
      'BinaryExpression:exit': endIndicator,

      AssignmentPattern() {
        indicatorStack.push(true)
      },
      'AssignmentPattern:exit': endIndicator,

      NewExpression(node: Node) {
        indicatorStack.push(isValidFunctionCall(context, options as Options, { callee: resolveCallee(node) }))
      },
      'NewExpression:exit': endIndicator,

      CallExpression(node: Node) {
        indicatorStack.push(isValidFunctionCall(context, options as Options, { callee: resolveCallee(node) }))
      },
      'CallExpression:exit': endIndicator,

      TaggedTemplateExpression(node: Node) {
        indicatorStack.push(isValidFunctionCall(context, options as Options, { callee: resolveCallee(node) }))
      },
      'TaggedTemplateExpression:exit': endIndicator,

      'AssignmentExpression[left.type="MemberExpression"]'(node: Node) {
        const expression = node as unknown as { left: { property: { name?: string } } }
        const objectProperties = (options['object-properties'] as SkipPatterns | undefined) ?? {}
        indicatorStack.push(shouldSkip(objectProperties, expression.left.property.name ?? ''))
      },
      'AssignmentExpression[left.type="MemberExpression"]:exit': endIndicator,

      TemplateLiteral(node: Node) {
        if (!validateTemplate) return

        if (framework === 'react' && filterOutJSX(node)) return

        if (isValidScope()) return

        const literal = node as unknown as { quasis: Array<{ value: { raw: string } }> }
        literal.quasis.some(({ value: { raw } }) => {
          if (isValidLiteral(options as Options, { value: raw })) return false
          report(node)
          return true
        })
      },

      Literal(node: Node) {
        const literal = node as unknown as { value: unknown; parent: { type: string; key?: Node } }

        if (['MemberExpression', 'SwitchCase'].includes(literal.parent.type)) {
          return
        }

        if (framework === 'react' && filterOutJSX(node)) {
          return
        }

        if (onlyValidateVueTemplate) {
          const parents = getAncestors(context, node)
          if (
            parents.length
            && parents.every(
              item => !['VElement', 'VAttribute', 'VText', 'VExpressionContainer'].includes(item.type)
            )
          ) {
            return
          }
        }

        if (literal.parent.key === node) {
          return
        }

        validateBeforeReport(node as unknown as Node & { value: unknown })
      }
    }

    const defineTemplateBodyVisitor = (parserServices as { defineTemplateBodyVisitor?: DefineTemplateBodyVisitor } | undefined)
      ?.defineTemplateBodyVisitor

    if (defineTemplateBodyVisitor) {
      const invoke = (name: string) => (node: Node) => {
        const handler = (scriptVisitor as unknown as Record<string, (node: Node) => void>)[name]
        handler?.(node)
      }

      return defineTemplateBodyVisitor(
        {
          VText: invoke('JSXText'),
          VLiteral: invoke('JSXText'),
          VElement: invoke('VElement'),
          'VElement:exit': invoke('VElement:exit'),
          VAttribute: invoke('VAttribute'),
          'VAttribute:exit': invoke('VAttribute:exit'),
          'VExpressionContainer CallExpression': invoke('CallExpression'),
          'VExpressionContainer CallExpression:exit': invoke('CallExpression:exit'),
          'VExpressionContainer Literal': invoke('Literal')
        },
        scriptVisitor
      )
    }

    return scriptVisitor
  }
}

type DefineTemplateBodyVisitor = (
  templateBodyVisitor: Record<string, (node: Node) => void>,
  scriptVisitor: Rule.RuleListener
) => Rule.RuleListener
