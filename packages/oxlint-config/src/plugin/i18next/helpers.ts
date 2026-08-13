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

import { DOM_TAGS, SVG_TAGS } from './constants'

const UPPERCASE_REGEX = /^[A-Z_-]+$/u

export function isUpperCase(str: string): boolean {
  return UPPERCASE_REGEX.test(str)
}

function isNativeDOMTag(str: string): boolean {
  return DOM_TAGS.includes(str)
}

function isSvgTag(str: string): boolean {
  return SVG_TAGS.includes(str)
}

const BLACKLIST_ATTRS = ['placeholder', 'alt', 'aria-label', 'value', 'title']

export function isAllowedDOMAttr(tag: string, attr: string): boolean {
  if (isSvgTag(tag)) return true
  if (isNativeDOMTag(tag)) {
    return !BLACKLIST_ATTRS.includes(attr)
  }
  return false
}

export function generateFullMatchRegExp(source: unknown): RegExp {
  if (source instanceof RegExp) {
    return source
  }

  if (typeof source !== 'string') {
    throw new TypeError(`generateFullMatchRegExp: expected string but got ${String(source)}`)
  }

  // oxlint-disable-next-line security-js/detect-non-literal-regexp
  return new RegExp(`^${source}${source.endsWith('$') ? '' : '$'}`)
}

const patternCache = new WeakMap<readonly unknown[], (text: string) => boolean>()

export function matchPatterns(patterns: readonly unknown[], text: string): boolean {
  let handler = patternCache.get(patterns)

  if (!handler) {
    handler = (str: string) => patterns.map(generateFullMatchRegExp).some(item => item.test(str))
    patternCache.set(patterns, handler)
  }

  return handler(text)
}

export interface SkipPatterns {
  include?: readonly unknown[]
  exclude?: readonly unknown[]
}

export function shouldSkip({ exclude = [], include = [] }: SkipPatterns, text: string): boolean {
  if (!include.length && !exclude.length) return false

  if (include.length && matchPatterns(include, text)) return false

  if (exclude.length && !matchPatterns(exclude, text)) return false

  return true
}

export interface AncestorNode {
  type: string
  parent?: (AncestorNode | undefined | null)
}

export function getNearestAncestor(node: AncestorNode, type: string): AncestorNode | null {
  let temp: AncestorNode | undefined | null = node.parent

  while (temp) {
    if (temp.type === type) {
      return temp
    }

    temp = temp.parent
  }

  return null
}
