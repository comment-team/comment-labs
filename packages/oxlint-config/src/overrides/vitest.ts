import type { OxlintOverride } from 'oxlint'


export const vitestOverrides: OxlintOverride = {
  files: [
    '**/{test,tests}/**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}',
    '**/*.{test,spec}.{js,jsx,ts,tsx,mjs,cjs,mts,cts}'
  ],
  rules: {
    'vitest/prefer-expect-assertions': [
      'warn', {
        onlyFunctionsWithExpectInCallback: true,
        onlyFunctionsWithExpectInLoop: true
      }
    ],
    'vitest/require-hook': 'warn'
  }
}
