import type { OxlintConfig } from 'oxlint'
import { categories } from './categories'
import { baseRules } from './base-rules'
import { stylisticRules } from './stylistic-rules'
import { plugins } from './plugins'
import { globals } from './globals'
import { jsPlugins } from './js-plugins'
import { i18nextOverrides } from './overrides/i18next'
import { playwrightOverrides } from './overrides/playwright'
import { reactOverrides } from './overrides/react'
import { reactNativeOverrides } from './overrides/react-native'
import { scriptsOverrides } from './overrides/scripts'
import { declarationsOverrides } from './overrides/declarations'


export const config: OxlintConfig = {
  options: {
    reportUnusedDisableDirectives: 'warn',
    typeAware: true,
    typeCheck: true
  },
  plugins,
  jsPlugins,
  rules: {
    ...baseRules,
    ...stylisticRules
  },
  globals,
  categories,
  settings: {
    vitest: {
      typecheck: true
    }
  },
  overrides: [
    declarationsOverrides,
    i18nextOverrides,
    playwrightOverrides,
    reactOverrides,
    reactNativeOverrides,
    scriptsOverrides
  ],
  ignorePatterns: [ 'coverage/**', 'public/**', '.expo/**', '.output/**', '**/dist/**', '**/*wasm-bindgen/**' ]
}
