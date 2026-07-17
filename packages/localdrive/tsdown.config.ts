import { defineConfig } from 'tsdown'


export default defineConfig({
  entry: [ 'src/index.ts', 'src/vitest.ts' ],
  format: [ 'esm' ],
  dts: true,
  sourcemap: true,
  deps: {
    neverBundle: [
      '@cloudflare/vitest-pool-workers',
      '@electric-sql/pglite',
      '@electric-sql/pglite-socket',
      'tinyglobby',
      'vitest',
      'vitest/node'
    ]
  }
})
