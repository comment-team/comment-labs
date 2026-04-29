import type { DummyRuleMap } from 'oxlint'


export const baseRules: DummyRuleMap = {
  'array-type': 'off',
  'capitalized-comments': 'off',
  'class-methods-use-this': 'off',
  'consistent-indexed-object-style': 'off',
  'consistent-type-definitions': 'off',
  'complexity': [ 'warn', { max: 50 }],
  'default-case': 'off',
  'exports-last': 'off',
  'explicit-function-return-type': 'off',
  'explicit-module-boundary-types': 'off',
  'func-style': 'off',
  'group-exports': 'off',
  'id-length': 'off',
  'init-declarations': 'off',
  'max-dependencies': 'off',
  'max-depth': [ 'warn', 7 ],
  'max-lines': [
    'warn',
    {
      max: 500,
      skipBlankLines: true,
      skipComments: true
    }
  ],
  'max-lines-per-function': [
    'warn',
    {
      max: 300,
      skipBlankLines: true,
      skipComments: true
    }
  ],
  'max-params': 'off',
  'max-statements': [ 'warn', { max: 50 }],
  'no-array-for-each': 'off',
  'no-array-method-this-argument': 'off',
  'no-array-reduce': 'off',
  'no-array-sort': 'off',
  'no-async-await': 'off',
  'no-await-expression-member': 'off',
  'no-await-in-loop': 'off',
  'no-bitwise': 'off',
  'new-cap': 'off',
  'no-console': 'off',
  'no-continue': 'off',
  'no-default-export': 'off',
  'no-extraneous-class': 'off',
  'no-inline-comments': 'off',
  'no-magic-numbers': 'off',
  'no-map-spread': 'off',
  'no-named-export': 'off',
  'no-namespace': 'off',
  'no-nested-ternary': 'off',
  'no-null': 'off',
  'no-negated-condition': 'off',
  'no-optional-chaining': 'off',
  'no-plusplus': 'off',
  'no-relative-parent-imports': 'off',
  'no-rest-spread-properties': 'off',
  'no-shadow': 'warn',
  'no-ternary': 'off',
  'no-undefined': 'off',
  'no-unassigned-import': 'off',
  'no-use-before-define': [ 'warn', { functions: false }],
  'no-warning-comments': 'off',
  'prefer-default-export': 'off',
  'prefer-destructuring': 'off',
  'require-await': 'off',
  'sort-imports': 'off',
  'sort-keys': 'off',

  'typescript/consistent-type-imports': [
    'warn',
    {
      disallowTypeAnnotations: false,
      fixStyle: 'inline-type-imports'
    }
  ],
  'typescript/no-import-type-side-effects': 'error',
  'typescript/parameter-properties': [ 'warn', { prefer: 'parameter-property' }],
  'typescript/prefer-readonly-parameter-types': 'off',
  'typescript/require-await': 'warn',
  'typescript/non-nullable-type-assertion-style': 'warn',
  'typescript/explicit-member-accessibility': 'off',
  'typescript/return-await': [ 'warn', 'always' ],

  'import/no-unassigned-import': 'warn',
  'import/consistent-type-specifier-style': 'off',
  'import/no-anonymous-default-export': 'off',
  'import/no-cycle': 'off',
  'import/no-nodejs-modules': 'off',
  'import/unambiguous': 'off',

  // TODO enable jest rules for vitest
  'jest/require-hook': 'off',
  'jest/no-conditional-in-test': 'off',
  'vitest/prefer-strict-boolean-matchers': 'off',

  'jsdoc/require-param-type': 'off',
  'jsdoc/require-returns': 'off',
  'jsdoc/require-param': 'off',

  'unicorn/no-nested-ternary': 'off',
  'unicorn/switch-case-braces': [ 'warn', 'avoid' ],
  'unicorn/no-array-method-this-argument': 'warn',
  'unicorn/no-await-expression-member': 'warn',

  'vitest/no-importing-vitest-globals': 'off',

  // custom rules
  'comment-labs-js/no-self-assign': 'error',

  // js plugin rules
  'brettz9-js/arrow-parens': 'off',
  'brettz9-js/block-scoped-var': 'off',
  'brettz9-js/no-instanceof-wrapper': 'error',
  'brettz9-js/no-literal-call': 'error',
  'brettz9-js/no-this-in-static': 'error',
  'brettz9-js/no-use-ignored-vars': 'warn',
  'brettz9-js/no-useless-rest-spread': 'warn',
  'brettz9-js/prefer-for-of': 'off',

  'i18next-js/no-literal-string': 'warn',

  'import-zod-js/prefer-zod-namespace': 'warn',

  'security-js/detect-unsafe-regex': 'error',
  'security-js/detect-non-literal-regexp': 'error',
  'security-js/detect-non-literal-require': 'off',
  'security-js/detect-non-literal-fs-filename': 'off',
  'security-js/detect-eval-with-expression': 'error',
  'security-js/detect-pseudoRandomBytes': 'error',
  'security-js/detect-possible-timing-attacks': 'error',
  'security-js/detect-no-csrf-before-method-override': 'error',
  'security-js/detect-buffer-noassert': 'error',
  'security-js/detect-child-process': 'error',
  'security-js/detect-disable-mustache-escape': 'error',
  'security-js/detect-object-injection': 'off',
  'security-js/detect-new-buffer': 'error',
  'security-js/detect-bidi-characters': 'error',

  'unicorn-js/better-regex': 'warn',
  'unicorn-js/consistent-destructuring': 'warn',
  'unicorn-js/consistent-template-literal-escape': 'warn',
  'unicorn-js/no-for-loop': 'warn',
  'unicorn-js/no-useless-iterator-to-array': 'warn',
  'unicorn-js/prefer-export-from': 'warn',
  'unicorn-js/prefer-simple-condition-first': 'warn',
  'unicorn-js/prefer-switch': 'warn',
  'unicorn-js/switch-case-break-position': 'warn',
  'unicorn-js/prefer-single-call': 'warn',

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
  ],

  'jsdoc-js/check-alignment': 'warn',
  'jsdoc-js/check-indentation': 'warn',
  'jsdoc-js/check-line-alignment': 'warn',
  'jsdoc-js/check-param-names': 'warn',
  'jsdoc-js/check-types': 'warn',
  'jsdoc-js/check-values': 'warn',
  'jsdoc-js/multiline-blocks': 'warn',
  'jsdoc-js/no-multi-asterisks': 'warn',
  'jsdoc-js/no-undefined-types': 'warn',
  'jsdoc-js/require-returns-check': 'warn',
  'jsdoc-js/require-yields-check': 'warn',
  'jsdoc-js/tag-lines': 'warn',
  'jsdoc-js/valid-types': 'warn',

  'e18e-js/prefer-array-at': 'error',
  'e18e-js/prefer-array-fill': 'error',
  'e18e-js/prefer-includes': 'error',
  'e18e-js/prefer-array-to-reversed': 'error',
  'e18e-js/prefer-array-to-sorted': 'error',
  'e18e-js/prefer-array-to-spliced': 'error',
  'e18e-js/prefer-nullish-coalescing': 'error',
  'e18e-js/prefer-object-has-own': 'error',
  'e18e-js/prefer-spread-syntax': 'error',
  'e18e-js/prefer-url-canparse': 'error',
  'e18e-js/ban-dependencies': 'error',
  'e18e-js/prefer-array-from-map': 'error',
  'e18e-js/prefer-timer-args': 'error',
  'e18e-js/prefer-date-now': 'error',
  'e18e-js/prefer-regex-test': 'error',
  'e18e-js/prefer-array-some': 'error',
  'e18e-js/prefer-static-regex': 'error',

  'no-control-regex': 'error',
  'no-misleading-character-class': 'error',
  'no-regex-spaces': 'error',
  // TODO add when supported
  // 'prefer-regex-literals': 'error',
  'no-invalid-regexp': 'off',
  'no-useless-backreference': 'off',
  'no-empty-character-class': 'off',

  'regexp-js/confusing-quantifier': 'warn',
  'regexp-js/control-character-escape': 'error',
  'regexp-js/match-any': 'error',
  'regexp-js/negation': 'error',
  'regexp-js/no-contradiction-with-assertion': 'error',
  'regexp-js/no-dupe-characters-character-class': 'error',
  'regexp-js/no-dupe-disjunctions': 'error',
  'regexp-js/no-empty-alternative': 'warn',
  'regexp-js/no-empty-capturing-group': 'error',
  'regexp-js/no-empty-character-class': 'error',
  'regexp-js/no-empty-group': 'error',
  'regexp-js/no-empty-lookarounds-assertion': 'error',
  'regexp-js/no-empty-string-literal': 'error',
  'regexp-js/no-escape-backspace': 'error',
  'regexp-js/no-extra-lookaround-assertions': 'error',
  'regexp-js/no-invalid-regexp': 'error',
  'regexp-js/no-invisible-character': 'error',
  'regexp-js/no-lazy-ends': 'warn',
  'regexp-js/no-legacy-features': 'error',
  'regexp-js/no-misleading-capturing-group': 'error',
  'regexp-js/no-misleading-unicode-character': 'error',
  'regexp-js/no-missing-g-flag': 'error',
  'regexp-js/no-non-standard-flag': 'error',
  'regexp-js/no-obscure-range': 'error',
  'regexp-js/no-optional-assertion': 'error',
  'regexp-js/no-potentially-useless-backreference': 'warn',
  'regexp-js/no-super-linear-backtracking': 'error',
  'regexp-js/no-trivially-nested-assertion': 'error',
  'regexp-js/no-trivially-nested-quantifier': 'error',
  'regexp-js/no-unused-capturing-group': 'error',
  'regexp-js/no-useless-assertions': 'error',
  'regexp-js/no-useless-backreference': 'error',
  'regexp-js/no-useless-character-class': 'error',
  'regexp-js/no-useless-dollar-replacements': 'error',
  'regexp-js/no-useless-escape': 'error',
  'regexp-js/no-useless-flag': 'warn',
  'regexp-js/no-useless-lazy': 'error',
  'regexp-js/no-useless-non-capturing-group': 'error',
  'regexp-js/no-useless-quantifier': 'error',
  'regexp-js/no-useless-range': 'error',
  'regexp-js/no-useless-set-operand': 'error',
  'regexp-js/no-useless-string-literal': 'error',
  'regexp-js/no-useless-two-nums-quantifier': 'error',
  'regexp-js/no-zero-quantifier': 'error',
  'regexp-js/optimal-lookaround-quantifier': 'warn',
  'regexp-js/optimal-quantifier-concatenation': 'error',
  'regexp-js/prefer-character-class': 'error',
  'regexp-js/prefer-d': 'error',
  'regexp-js/prefer-plus-quantifier': 'error',
  'regexp-js/prefer-predefined-assertion': 'error',
  'regexp-js/prefer-question-quantifier': 'error',
  'regexp-js/prefer-range': 'error',
  'regexp-js/prefer-set-operation': 'error',
  'regexp-js/prefer-star-quantifier': 'error',
  'regexp-js/prefer-unicode-codepoint-escapes': 'error',
  'regexp-js/prefer-w': 'error',
  'regexp-js/simplify-set-operations': 'error',
  'regexp-js/sort-flags': 'error',
  'regexp-js/strict': 'error',
  'regexp-js/use-ignore-case': 'error'
}
