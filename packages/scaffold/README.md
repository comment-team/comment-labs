# @comment-labs/scaffold

CLI tool for scaffolding consistent repository defaults across comment-labs projects.

## Installation

```bash
pnpm add -D @comment-labs/scaffold
```

## Usage

Run the scaffold CLI in your project directory:

```bash
npx comment-labs-scaffold
```

The CLI will guide you through setting up:

- package.json with proper defaults
- pnpm workspace configuration
- Git files (.gitignore, .gitattributes)
- EditorConfig
- Renovate configuration
- Changesets for versioning
- Knip for dead code detection
- TypeScript configuration
- ESLint and Oxlint setup

### Options

The CLI supports an auto-approve mode for CI environments:

```bash
npx comment-labs-scaffold --verify
```

## License

[Apache-2.0](https://github.com/comment-team/comment-labs/blob/main/LICENSE)
