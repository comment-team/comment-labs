// @ts-expect-error plugin does not export types
import reactNative from 'eslint-plugin-react-native'
import { sanitizePlugin } from '../sanitize-plugin'


export default sanitizePlugin(reactNative)
