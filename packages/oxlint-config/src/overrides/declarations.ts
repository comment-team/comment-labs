import type { OxlintOverride } from 'oxlint'


export const declarationsOverrides: OxlintOverride = {
  files: [ '**/*.d.ts' ],
  rules: {
    'typescript/no-empty-interface': 'off',
    'typescript/no-empty-object-type': 'off'
  }
}
