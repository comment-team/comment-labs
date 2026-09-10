import { defineConfig } from 'oxlint'
import { config } from '@comment-labs/oxlint-config'

export default defineConfig({
  ...config,
  rules: {
    ...config.rules,
    'no-void': [ 'error', { allowAsStatement: true }]
  }
})
