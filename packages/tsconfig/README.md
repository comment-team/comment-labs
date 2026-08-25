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
| Workers with Vitest | `@comment-labs/tsconfig/workers-vitest` |
| Astro | `@comment-labs/tsconfig/astro-workers` |
| Astro with React | `@comment-labs/tsconfig/react-astro` |
| Astro with React on Workers | `@comment-labs/tsconfig/react-astro-workers` |
| React web | `@comment-labs/tsconfig/react` |
| React Native / Expo | `@comment-labs/tsconfig/react-native` |

If none of these fit, fall back to `@comment-labs/tsconfig/base`.

All presets enable strict type checking, bundler module resolution, isolated modules and target `ES2023`.

### Workers with Vitest

The `workers-vitest` preset is split into three configs so `tsc --build` can type-check the app and its Worker tests as separate project references:

- `@comment-labs/tsconfig/workers-vitest` — root config for config files and scripts.
- `@comment-labs/tsconfig/workers-vitest-app` — app source (`composite`, declaration-emitting).
- `@comment-labs/tsconfig/workers-vitest-test` — Worker tests with the Cloudflare Vitest pool types.

```json
// tsconfig.json
{
  "extends": "@comment-labs/tsconfig/workers-vitest",
  "compilerOptions": { "paths": { "#/*": ["./src/*"] } },
  "include": ["e2e", "scripts", "*.ts"],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./test/tsconfig.json" }
  ]
}
```

```json
// tsconfig.app.json
{
  "extends": "@comment-labs/tsconfig/workers-vitest-app",
  "compilerOptions": {
    "paths": { "#/*": ["./src/*"] },
    "outDir": "build/src",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

```json
// test/tsconfig.json
{
  "extends": "@comment-labs/tsconfig/workers-vitest-test",
  "compilerOptions": {
    "paths": { "#/*": ["../src/*"] },
    "outDir": "../build/test"
  },
  "include": ["**/*", "*.ts", "../src/environment.d.ts"],
  "references": [{ "path": "../tsconfig.app.json" }]
}
```

## License

[Apache-2.0](https://github.com/comment-team/comment-labs/blob/main/LICENSE)
