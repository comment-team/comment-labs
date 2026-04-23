import { defineConfig, type OxlintConfig } from 'oxlint'
import { categories } from './categories'
import { baseRules } from './base-rules'
import { plugins } from './plugins'
import { globals } from './globals'
import { jsPlugins } from './js-plugins'
import { playwrightOverrides } from './overrides/playwright'
import { reactOverrides } from './overrides/react'
import { reactNativeOverrides } from './overrides/react-native'
import { defu } from 'defu'
import type { DeepPartial } from './utils'


export const config: (userConfig?: DeepPartial<OxlintConfig>) => OxlintConfig = userConfig => defineConfig(defu({
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
    reactNativeOverrides
  ],
  ignorePatterns: [ 'coverage/**', 'public/**', '.expo/**', '.output/**', '**/dist/**', '**/*wasm-bindgen/**' ]
}, userConfig))

export { commentLabsJs as default } from './plugin'
