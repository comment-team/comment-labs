import { createConsoleReporter, defineDiagnostics } from 'nostics'


export const diagnostics = defineDiagnostics({
  docsBase: code => `https://github.com/comment-labs/i18next-validator/blob/main/docs/diagnostics/${code.toLowerCase()}.md`,
  reporters: [ createConsoleReporter() ],
  codes: {
    I18V_1001: {
      why: 'Could not find an i18next initialization file.',
      fix: 'Run with --init-file to point to the file, or provide --locales and --default-ns directly.'
    },
    I18V_1002: {
      why: 'Found multiple i18next initialization candidates.',
      fix: 'Disambiguate with --init-file, or provide --locales and --default-ns directly.'
    },
    I18V_1003: {
      why: 'Failed to parse the i18next initialization file.',
      fix: 'Fix the syntax error in the file, or exclude it from scanning.'
    },
    I18V_1004: {
      why: 'Could not extract i18next configuration from the initialization file.',
      fix: 'Provide --locales and --default-ns explicitly, or ensure the init call is statically analyzable.'
    },
    I18V_1005: {
      why: 'Could not determine where translation files live.',
      fix: 'Provide the path with --locales.'
    },
    I18V_1006: {
      why: 'Could not determine the default i18next namespace.',
      fix: 'Provide it with --default-ns.'
    },
    I18V_1007: {
      why: 'Failed to load a locale file.',
      fix: 'Ensure the file is valid JSON or a JavaScript module exporting translations.'
    },
    I18V_1008: {
      why: 'Source path does not exist.',
      fix: 'Check the path passed to --source.'
    },
    I18V_1009: {
      why: 'No translation keys found in the locale files.',
      fix: 'Verify the locale files use the expected i18next JSON shape.'
    }
  }
})
