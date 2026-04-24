# @comment-labs/assert-env

Type-safe environment variable validation.

## Installation

```bash
pnpm add @comment-labs/assert-env
```

## Usage

```ts
import { assertEnv } from '@comment-labs/assert-env'

const env = assertEnv(
  {
    ACCOUNT_ID: 'string',
    PORT: 'number'
  },
  {
    optional: {
      DEBUG: 'boolean'
    }
  }
)

env.ACCOUNT_ID
env.PORT
env.DEBUG
```

## Supported Types

- `string`
- `number`
- `boolean`

## Validation Behavior

- Required variables must be set.
- `string` values must not be empty or whitespace-only.
- `number` values are trimmed before parsing and support floats and negative numbers.
- `boolean` values accept `true`, `false`, `1`, `0`, `yes`, and `no`, case-insensitively.
- Optional variables are omitted when missing or blank.
- Invalid variables are reported together in a single error.

## License

[Apache-2.0](https://github.com/comment-team/comment-labs/blob/main/LICENSE)
