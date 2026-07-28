import type { OxlintOverride } from 'oxlint'


export const ambientOverrides: OxlintOverride = {
  files: [ '**/src/env.d.ts', '**/src/environment.d.ts' ],
  rules: {
    'no-redeclare': 'off'
  }
}
