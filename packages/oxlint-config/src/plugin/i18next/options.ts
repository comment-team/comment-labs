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

// oxlint-disable stylistic-js/array-bracket-spacing

import { htmlEntities } from './html-entities'

export const defaults = {
  framework: 'react' as const,
  mode: 'jsx-text-only' as const,
  'jsx-components': {
    include: [] as readonly string[],
    exclude: ['Trans'] as readonly string[]
  },
  'jsx-attributes': {
    include: [] as readonly string[],
    exclude: [
      'className',
      'styleName',
      'style',
      'type',
      'key',
      'id',
      'width',
      'height'
    ] as readonly string[]
  },
  words: {
    exclude: [
      '[0-9!-/:-@[-`{-~]+',
      '[A-Z_-]+',
      htmlEntities,
      /^\p{Emoji}+$/u
    ] as readonly (string | RegExp)[]
  },
  callees: {
    exclude: [
      'i18n(ext)?',
      't',
      'require',
      'addEventListener',
      'removeEventListener',
      'postMessage',
      'getElementById',
      'dispatch',
      'commit',
      'includes',
      'indexOf',
      'endsWith',
      'startsWith'
    ] as readonly string[]
  },
  'object-properties': {
    include: [] as readonly string[],
    exclude: ['[A-Z_-]+'] as readonly string[]
  },
  'class-properties': {
    include: [] as readonly string[],
    exclude: ['displayName'] as readonly string[]
  },
  message: 'disallow literal string',
  'should-validate-template': false
}

export type RuleOptions = typeof defaults

export const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    framework: {
      type: 'string',
      enum: ['react', 'vue']
    },
    mode: {
      type: 'string',
      enum: ['jsx-text-only', 'jsx-only', 'all', 'vue-template-only']
    },
    'jsx-components': {
      type: 'object',
      properties: {
        include: { type: 'array' },
        exclude: { type: 'array' }
      }
    },
    'jsx-attributes': {
      type: 'object',
      properties: {
        include: { type: 'array' },
        exclude: { type: 'array' }
      }
    },
    words: {
      type: 'object',
      properties: {
        exclude: { type: 'array' }
      }
    },
    callees: {
      type: 'object',
      properties: {
        include: { type: 'array' },
        exclude: { type: 'array' }
      }
    },
    'object-properties': {
      type: 'object',
      properties: {
        include: { type: 'array' },
        exclude: { type: 'array' }
      }
    },
    'class-properties': {
      type: 'object',
      properties: {
        include: { type: 'array' },
        exclude: { type: 'array' }
      }
    },
    message: { type: 'string' },
    'should-validate-template': { type: 'boolean' }
  }
}
