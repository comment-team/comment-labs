import { defineConfig } from 'vitest/config'


export default defineConfig({
  test: {
    exclude: [ '**/node_modules/**', '**/dist/**', 'tests/cloudflare/**' ],
    coverage: {
      provider: 'v8',
      reporter: [ 'text', 'json', 'html', 'lcov' ],
      include: [ 'src/**/*.ts' ],
      // index.ts is a re-export barrel, types.ts has no runtime code, and
      // database-host-worker.ts is a three-line worker bootstrap whose logic
      // lives in database-host.ts.
      exclude: [ 'src/index.ts', 'src/types.ts', 'src/database-host-worker.ts' ],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100
      }
    }
  }
})
