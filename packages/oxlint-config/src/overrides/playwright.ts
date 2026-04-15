import type { OxlintOverride } from 'oxlint'


export const playwrightOverrides: OxlintOverride = {
  files: [ '**/e2e/**/*' ],
  rules: {
    'playwright-js/consistent-spacing-between-blocks': 'warn',
    'playwright-js/expect-expect': 'warn',
    'playwright-js/max-nested-describe': 'warn',
    'playwright-js/missing-playwright-await': 'error',
    'playwright-js/no-conditional-expect': 'warn',
    'playwright-js/no-conditional-in-test': 'warn',
    'playwright-js/no-duplicate-hooks': 'warn',
    'playwright-js/no-duplicate-slow': 'warn',
    'playwright-js/no-element-handle': 'warn',
    'playwright-js/no-eval': 'warn',
    'playwright-js/no-focused-test': 'error',
    'playwright-js/no-force-option': 'warn',
    'playwright-js/no-nested-step': 'warn',
    'playwright-js/no-networkidle': 'error',
    'playwright-js/no-page-pause': 'warn',
    'playwright-js/no-skipped-test': 'warn',
    'playwright-js/no-standalone-expect': 'error',
    'playwright-js/no-unsafe-references': 'error',
    'playwright-js/no-unused-locators': 'error',
    'playwright-js/no-useless-await': 'warn',
    'playwright-js/no-useless-not': 'warn',
    'playwright-js/no-wait-for-navigation': 'error',
    'playwright-js/no-wait-for-selector': 'warn',
    'playwright-js/no-wait-for-timeout': 'warn',
    'playwright-js/prefer-hooks-in-order': 'warn',
    'playwright-js/prefer-hooks-on-top': 'warn',
    'playwright-js/prefer-locator': 'warn',
    'playwright-js/prefer-to-have-count': 'warn',
    'playwright-js/prefer-to-have-length': 'warn',
    'playwright-js/prefer-web-first-assertions': 'error',
    'playwright-js/valid-describe-callback': 'error',
    'playwright-js/valid-expect': 'error',
    'playwright-js/valid-expect-in-promise': 'error',
    'playwright-js/valid-test-tags': 'error',
    'playwright-js/valid-title': 'error'
  }
}
