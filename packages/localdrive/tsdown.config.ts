import { defineConfig } from 'tsdown'


export default defineConfig({
  entry: [ 'src/index.ts', 'src/vitest.ts', 'src/query-client.ts', 'src/cloudflare-test-client.ts', 'src/playwright.ts' ],
  format: [ 'esm' ],
  dts: true,
  sourcemap: true,
  deps: {
    neverBundle: [
      '@cloudflare/vitest-plugin',
      '@electric-sql/pglite',
      '@electric-sql/pglite-socket',
      '@playwright/test',
      '@vitest/runner',
      'postgres',
      'tinyglobby',
      'vitest',
      'vitest/node'
    ]
  }
})
