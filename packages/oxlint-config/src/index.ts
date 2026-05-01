import type { OxlintConfig } from 'oxlint'
import { categories } from './categories'
import { baseRules } from './base-rules'
import { plugins } from './plugins'
import { globals } from './globals'
import { jsPlugins } from './js-plugins'
import { playwrightOverrides } from './overrides/playwright'
import { reactOverrides } from './overrides/react'
import { reactNativeOverrides } from './overrides/react-native'
import { scriptsOverrides } from './overrides/scripts'


export const config: OxlintConfig = {
  options: {
    reportUnusedDisableDirectives: 'warn',
    typeAware: true,
    typeCheck: true
  },
  plugins,
  jsPlugins,
  rules: baseRules,
  globals,
  categories,
  settings: {
    vitest: {
      typecheck: true
    }
  },
  overrides: [
    playwrightOverrides,
    reactOverrides,
    reactNativeOverrides,
    scriptsOverrides
  ],
  ignorePatterns: [ 'coverage/**', 'public/**', '.expo/**', '.output/**', '**/dist/**', '**/*wasm-bindgen/**' ]
}
