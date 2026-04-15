import type { OxlintOverride } from 'oxlint'


export const reactOverrides: OxlintOverride = {
  files: [ '**/*.?(c|m)@(j|t)sx' ],
  rules: {
    'react-hooks-js/exhaustive-deps': 'error',
    'react-hooks-js/rules-of-hooks': 'warn',

    'react-refresh-js/only-export-components': 'warn'
  }
}
