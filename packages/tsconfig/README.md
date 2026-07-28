# @comment-labs/tsconfig

Shared TypeScript configuration presets for comment-labs projects.

## Installation

```bash
pnpm add -D @comment-labs/tsconfig typescript
```

TypeScript `^5.9.2 || ^6.x` is required.

## Usage

Create a `tsconfig.json` in your project and extend the preset that matches your target runtime:

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

Then type-check with:

```bash
pnpm tsc --noEmit
```

## Picking a preset

| Project type | Extend path |
|---|---|
| Node.js | `@comment-labs/tsconfig/node` |
| Cloudflare Workers | `@comment-labs/tsconfig/workers` |
| Workers with React | `@comment-labs/tsconfig/react-workers` |
| Astro | `@comment-labs/tsconfig/astro-workers` |
| Astro with React | `@comment-labs/tsconfig/react-astro` |
| Astro with React on Workers | `@comment-labs/tsconfig/react-astro-workers` |
| React web | `@comment-labs/tsconfig/react` |
| React Native / Expo | `@comment-labs/tsconfig/react-native` |

If none of these fit, fall back to `@comment-labs/tsconfig/base`.

All presets enable strict type checking, bundler module resolution, isolated modules and target `ES2023`.

## License

[Apache-2.0](https://github.com/comment-team/comment-labs/blob/main/LICENSE)
