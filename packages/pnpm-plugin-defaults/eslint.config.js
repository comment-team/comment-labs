import { config } from 'bundled-eslint-config'
import oxlint from 'eslint-plugin-oxlint'
import oxlintConfig from './oxlint.config.ts'


export default config({}, [
  ...oxlint.buildFromOxlintConfig(oxlintConfig),
  {
    linterOptions: {
      reportUnusedDisableDirectives: false
    }
  }
])
