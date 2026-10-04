import type { OxlintOverride } from 'oxlint'


export const declarationsOverrides: OxlintOverride = {
  files: [ '**/*.d.ts' ],
  rules: {
    'no-redeclare': 'off',
    'typescript/no-empty-interface': 'off',
    'typescript/no-empty-object-type': 'off'
  }
}
