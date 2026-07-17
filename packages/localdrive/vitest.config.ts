import { defineConfig } from 'vitest/config'


export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: [ 'text', 'json', 'html', 'lcov' ],
      include: [ 'src/**/*.ts' ],
      exclude: [ 'src/index.ts', 'src/types.ts' ],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100
      }
    }
  }
})
