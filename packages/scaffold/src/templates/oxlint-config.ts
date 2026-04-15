import { dedent } from 'ts-dedent'


export function oxlintConfigTemplate(): string {
  return dedent`
    import { defineConfig } from 'oxlint'
    import { config } from '@comment-labs/oxlint-config'


    export default defineConfig(config)
  `
}
