# @comment-labs/schema-validator

CLI tool for validating JSON, YAML, and TOML files against JSON Schema.

## Installation

```bash
pnpm add -D @comment-labs/schema-validator
```

## Usage

Validate files in your project:

```bash
npx schema-validator [files-or-folders...]
```

If no paths are provided, the current working directory is used.

### Options

- `--add-recommended` - Save recommended schema hints into files that lack one
- `--update-recommended` - Replace existing schema hints with current recommendations
- `--reporter <cli|github>` - Output style (default: cli, auto-detects GitHub Actions)
- `--github-actions` - Shortcut for `--reporter github`
- `-h, --help` - Show help

### GitHub Actions

The validator automatically detects GitHub Actions and outputs annotations:

```yaml
- name: Validate schemas
  run: npx schema-validator --github-actions
```

## Supported File Types

- JSON (with JSONC support)
- YAML (.yaml, .yml)
- TOML (.toml)

## License

[Apache-2.0](https://github.com/comment-team/comment-labs/blob/main/LICENSE)
