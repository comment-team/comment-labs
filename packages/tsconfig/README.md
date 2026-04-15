# @comment-labs/tsconfig

Base TypeScript configurations for comment-labs projects.

## Installation

```bash
pnpm add -D @comment-labs/tsconfig typescript
```

## Usage

Extend one of the preset configurations in your `tsconfig.json`:

```json
{
  "extends": "@comment-labs/tsconfig/node",
  "compilerOptions": {
    "paths": {
      "#/*": ["./src/*"]
    }
  },
  "include": ["src/**/*", "*.ts"]
}
```

## Available Presets

- `@comment-labs/tsconfig/base` - Base configuration for any project
- `@comment-labs/tsconfig/node` - Node.js projects
- `@comment-labs/tsconfig/react` - React web projects
- `@comment-labs/tsconfig/react-native` - React Native / Expo projects
- `@comment-labs/tsconfig/workers` - Cloudflare Workers

## Base Configuration Features

- ES2023 target
- Strict type checking enabled
- Bundler module resolution
- Isolated modules
- Import path aliasing support (`#/*`)

## License

[Apache-2.0](https://github.com/comment-team/comment-labs/blob/main/LICENSE)
