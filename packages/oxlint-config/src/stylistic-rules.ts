import type { DummyRuleMap } from 'oxlint'


export const stylisticRules: DummyRuleMap = {
  'stylistic-js/type-generic-spacing': 'warn',
  'stylistic-js/type-named-tuple-spacing': 'warn',
  'stylistic-js/function-call-spacing': [
    'warn',
    'never'
  ],
  'stylistic-js/semi': [
    'warn',
    'never'
  ],
  'stylistic-js/space-before-blocks': 'warn',
  'stylistic-js/space-before-function-paren': [
    'warn',
    {
      'anonymous': 'never',
      'asyncArrow': 'always',
      'named': 'never'
    }
  ],
  'stylistic-js/space-infix-ops': [ 'warn', { int32Hint: false }],
  'stylistic-js/semi-spacing': 'warn',
  'stylistic-js/type-annotation-spacing': [
    'warn', {
      after: true, before: true,
      overrides: { colon: { after: true, before: false } }
    }
  ],
  'stylistic-js/member-delimiter-style': [
    'warn', {
      multiline: { delimiter: 'none', requireLast: true },
      singleline: { delimiter: 'semi', requireLast: false }
    }
  ],
  'stylistic-js/quotes': [ 'warn', 'single' ],
  'stylistic-js/rest-spread-spacing': 'warn',
  'stylistic-js/space-in-parens': [
    'warn',
    'never'
  ],
  'stylistic-js/spaced-comment': [
    'warn',
    'always',
    {
      'line': {
        'markers': [ '/' ]
      },
      'block': {
        'markers': [ '!', '*' ],
        'balanced': true
      }
    }
  ],
  'stylistic-js/template-curly-spacing': [
    'warn',
    'never'
  ],
  'stylistic-js/template-tag-spacing': 'warn',
  'stylistic-js/array-bracket-newline': [
    'warn',
    {
      'multiline': true
    }
  ],
  'stylistic-js/array-bracket-spacing': [
    'warn',
    'always',
    {
      'arraysInArrays': false,
      'objectsInArrays': false
    }
  ],
  'stylistic-js/arrow-parens': [
    'warn',
    'as-needed'
  ],
  'stylistic-js/arrow-spacing': 'warn',
  'stylistic-js/block-spacing': [
    'warn',
    'always'
  ],
  'stylistic-js/brace-style': [
    'warn',
    '1tbs'
  ],
  'stylistic-js/comma-dangle': [
    'warn',
    'never'
  ],
  'stylistic-js/comma-spacing': [
    'warn',
    {
      'after': true,
      'before': false
    }
  ],
  'stylistic-js/comma-style': [
    'warn',
    'last'
  ],
  'stylistic-js/dot-location': [
    'warn',
    'property'
  ],
  'stylistic-js/eol-last': [
    'warn',
    'always'
  ],
  'stylistic-js/function-call-argument-newline': [
    'warn',
    'consistent'
  ],
  'stylistic-js/function-paren-newline': [
    'warn',
    'multiline-arguments'
  ],
  'stylistic-js/indent': [
    'warn',
    2,
    {
      'SwitchCase': 1
    }
  ],
  'stylistic-js/key-spacing': [
    'warn',
    {
      'afterColon': true,
      'beforeColon': false,
      'mode': 'strict'
    }
  ],
  'stylistic-js/keyword-spacing': [
    'warn',
    {
      'after': true,
      'before': true
    }
  ],
  'stylistic-js/linebreak-style': [
    'error',
    'unix'
  ],
  'stylistic-js/lines-between-class-members': [
    'warn',
    'always',
    {
      'exceptAfterSingleLine': true
    }
  ],
  'stylistic-js/max-len': [
    'warn',
    {
      'code': 120,
      'comments': 180,
      'ignoreRegExpLiterals': true,
      'ignoreStrings': true,
      'ignoreTemplateLiterals': true,
      'ignoreTrailingComments': true,
      'ignoreUrls': true
    }
  ],
  'stylistic-js/max-statements-per-line': 'warn',
  'stylistic-js/new-parens': 'warn',
  'stylistic-js/no-confusing-arrow': 'off',
  'stylistic-js/no-extra-parens': [
    'warn',
    'functions'
  ],
  'stylistic-js/no-extra-semi': 'warn',
  'stylistic-js/no-floating-decimal': 'warn',
  'stylistic-js/no-mixed-operators': [
    'warn', {
      'groups': [
        [ '&', '|', '^', '~', '<<', '>>', '>>>' ],
        [ '==', '!=', '===', '!==', '>', '>=', '<', '<=' ],
        [ '&&', '||' ],
        [ 'in', 'instanceof' ]
      ]
    }
  ],
  'stylistic-js/no-mixed-spaces-and-tabs': 'warn',
  'stylistic-js/no-multi-spaces': 'warn',
  'stylistic-js/no-multiple-empty-lines': [
    'warn',
    {
      'max': 2,
      'maxEOF': 0
    }
  ],
  'stylistic-js/no-tabs': 'warn',
  'stylistic-js/no-trailing-spaces': 'warn',
  'stylistic-js/no-whitespace-before-property': 'warn',
  'stylistic-js/object-curly-newline': [
    'warn',
    {
      'ExportDeclaration': {
        'multiline': true
      },
      'ImportDeclaration': {
        'multiline': true
      }
    }
  ],
  'stylistic-js/object-curly-spacing': [
    'warn',
    'always'
  ],
  'stylistic-js/operator-linebreak': [
    'warn',
    'before'
  ],
  'stylistic-js/padding-line-between-statements': [
    'warn',
    { blankLine: 'always', prev: '*', next: 'return' },
    { blankLine: 'always', prev: '*', next: 'function' },
    { blankLine: 'always', prev: '*', next: 'iife' },
    { blankLine: 'always', prev: '*', next: 'class' },
    { blankLine: 'always', prev: '*', next: 'do' },
    { blankLine: 'always', prev: '*', next: 'for' },
    { blankLine: 'always', prev: '*', next: 'throw' },
    { blankLine: 'always', prev: '*', next: 'try' },
    { blankLine: 'always', prev: '*', next: 'while' },
    { blankLine: 'always', prev: '*', next: 'switch' },

    { blankLine: 'always', prev: '*', next: 'const' },
    { blankLine: 'any', prev: 'const', next: 'const' },
    { blankLine: 'any', prev: 'let', next: 'const' },
    { blankLine: 'always', prev: '*', next: 'let' },
    { blankLine: 'any', prev: 'let', next: 'let' },
    { blankLine: 'any', prev: 'const', next: 'let' },

    { blankLine: 'always', prev: '*', next: 'export' },
    { blankLine: 'any', prev: 'export', next: 'export' },
    { blankLine: 'always', prev: 'block-like', next: '*' },
    { blankLine: 'always', prev: 'multiline-block-like', next: '*' }
  ]
}
