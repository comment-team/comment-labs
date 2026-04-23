import { defineConfig } from 'tsdown'


export default defineConfig({
  entry: [ 'src/index.ts', 'src/plugins/*' ],
  format: 'esm',
  dts: true,
  shims: true,
  sourcemap: true,
  deps: {
    neverBundle: [ 'oxlint', 'oxlint-tsgolint', 'eslint', 'eslint-plugin-unicorn' ]
  }
})
