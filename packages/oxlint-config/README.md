# @comment-labs/oxlint-config

Shared Oxlint configuration for comment-labs projects. Provides sensible defaults for TypeScript, JavaScript, React, and Node.js projects.

## Installation

```bash
pnpm add -D @comment-labs/oxlint-config
```

## Usage

Create an `oxlint.config.ts` file in your project root:

```typescript
import { defineConfig } from 'oxlint'
import { config } from '@comment-labs/oxlint-config'

export default defineConfig(config)
```

## Features

- Pre-configured rules for TypeScript, React, and Node.js
- Import and JSDoc plugin support
- Vitest compatibility
- Optimized for correctness and performance

## License

[Apache-2.0](https://github.com/comment-team/comment-labs/blob/main/LICENSE)
