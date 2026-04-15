import { defineConfig } from 'tsdown'


export default defineConfig({
  entry: {
    pnpmfile: './src/index.ts'
  },
  outDir: '.',
  format: [ 'cjs' ],
  sourcemap: true
})
