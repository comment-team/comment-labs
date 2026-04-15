import { dedent } from 'ts-dedent'


export function eslintConfigTemplate(): string {
  return dedent`
    import { config } from 'bundled-eslint-config'
    import oxlint from 'eslint-plugin-oxlint'
    import oxlintConfig from './oxlint.config.ts'


    export default config({}, [
      ...oxlint.buildFromOxlintConfig(oxlintConfig),
      {
        linterOptions: {
          reportUnusedDisableDirectives: false
        }
      }
    ])
  `
}

export const legacyBundledEslintReexport = 'export { default } from \'bundled-eslint-config\''
