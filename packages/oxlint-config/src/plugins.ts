import type { OxlintConfig } from 'oxlint'


export const plugins: NonNullable<OxlintConfig['plugins']> = [
  'eslint',
  'oxc',
  'typescript',
  'unicorn',
  'import',
  'jsdoc',
  'react',
  'react-perf',
  'vitest',
  'jsx-a11y',
  'promise',
  'node',
  'vue'
]
