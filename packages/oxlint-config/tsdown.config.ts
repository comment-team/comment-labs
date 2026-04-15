import { defineConfig } from 'tsdown'


export default defineConfig({
  entry: [ 'src/index.ts' ],
  format: 'esm',
  dts: true,
  shims: true,
  sourcemap: true,
  deps: {
    neverBundle: [ 'oxlint', 'oxlint-tsgolint', 'eslint' ]
  }
})
