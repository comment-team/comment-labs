import { defineConfig } from 'oxlint'
import { config } from './dist/index.mjs'


export default defineConfig({
  extends: [ config ],
  ignorePatterns: [ 'tests/fixtures/**/*' ]
})
