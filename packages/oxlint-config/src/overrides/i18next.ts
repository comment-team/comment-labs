import { enableMode } from '#/utils'
import type { OxlintOverride } from 'oxlint'


const i18next = await enableMode([], [ 'i18next' ])

export const i18nextOverrides: OxlintOverride = {
  files: [ i18next ? '**/*' : '___disabled' ],
  rules: {
    'i18next-js/no-literal-string': 'warn'
  }
}
