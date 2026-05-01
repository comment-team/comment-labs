import type { OxlintOverride } from 'oxlint'


export const scriptsOverrides: OxlintOverride = {
  files: [ 'scripts/**/*.?(m)@(j|t)sx' ],
  rules: {
    'unicorn/no-process-exit': 'warn'
  }
}
