# @comment-labs/pnpm-plugin-defaults

A pnpm plugin that provides default configuration settings and hooks for consistent pnpm behavior across projects.

## Installation

```bash
pnpm add --config @comment-labs/pnpm-plugin-defaults
```

## Usage

Once installed, the plugin automatically configures pnpm with the following defaults:

- Disables builds for specific packages (esbuild, sharp, etc.)
- Enables deduplication of peer dependents
- Configures strict peer dependency checking
- Sets minimum release age to 3 days
- Enables shell emulator

The plugin runs automatically via pnpm hooks - no additional configuration required.

## License

[Apache-2.0](https://github.com/comment-team/comment-labs/blob/main/LICENSE)
