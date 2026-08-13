import { defineConfig } from 'oxlint'
import { config } from '@comment-labs/oxlint-config'


export default defineConfig({
  extends: [ config ],
  ignorePatterns: [ 'tests/fixtures/**/*' ],
  rules: {
    // A Node CLI is allowed to read files synchronously during startup/discovery.
    'node/no-sync': 'off'
  },
  overrides: [
    {
      files: [ 'src/cli.ts' ],
      rules: {
        // The tab completion tree is set up at module load time, not inside a vitest hook.
        'vitest/require-hook': 'off'
      }
    }
  ]
})
