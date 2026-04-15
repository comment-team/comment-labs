import { defineConfig } from 'tsdown'


export default defineConfig({
  entry: {
    pnpmfile: './src/index.ts'
  },
  outDir: '.',
  clean: [ 'pnpmfile.cjs' ],
  format: [ 'cjs' ],
  sourcemap: true
})
