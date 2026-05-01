import type { OxlintOverride } from 'oxlint'


export const scriptsOverrides: OxlintOverride = {
  files: [ 'scripts/**/*.?(m)@(j|t)s' ],
  rules: {
    'unicorn/no-process-exit': 'warn'
  }
}
