import { enableMode } from '#/utils'
import type { OxlintOverride } from 'oxlint'


const reactNative = await enableMode([], [ 'react-native' ])

export const reactNativeOverrides: OxlintOverride = {
  files: [ reactNative ? '**/*.?(m)@(j|t)sx' : '___disabled' ],
  rules: {
    'react-native-js/no-color-literals': 'warn',
    'react-native-js/no-inline-styles': 'warn',
    'react-native-js/no-raw-text': 'off',
    'react-native-js/no-single-element-style-arrays': 'warn',
    'react-native-js/no-unused-styles': 'warn',
    'react-native-js/sort-styles': 'off',
    'react-native-js/split-platform-components': 'error'
  }
}
