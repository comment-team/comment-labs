# @comment-labs/i18next-validator

Finds unused (dead) translation keys in [i18next](https://www.i18next.com/) projects — before they rot in your locale bundles.

Locale files grow by accretion: features ship, get renamed, get deleted, and the keys they leave behind keep shipping to every user. This tool cross-references your locale files against what your source code actually calls — through `t(...)`, `i18next.t(...)`, `useTranslation(...)`, or keys built at the callsite — and reports every key nobody reaches. It is **configless**: instead of asking you to re-describe your i18next setup, it reads your i18next initialization file and picks up the namespaces, separators, locale sources, and fallbacks you already configured.

## Installation

```bash
pnpm add -D @comment-labs/i18next-validator
```

## Usage

Run it at your project root:

```bash
npx i18next-validator
```

With no arguments it finds your i18next init file (typical paths like `src/i18n.ts`, `i18n/index.ts`, `app/i18n.*` are probed), resolves your locale files from it, and scans `./src` for key usage. When it cannot resolve something, it prompts interactively (in a TTY) instead of failing.

### Options

- `--init-file <path>` — path to the i18next initialization file
- `--locales <path>` — path to locale files or directory (overrides what the init file declares)
- `--default-ns <ns>` — default i18next namespace
- `--source <path>` — source directory to scan (auto-detected from `./src` or the init file)
- `--format <format>` — output format: `terminal`, `json`, `csv` (default: `terminal`)
- `--fail-on-dead` — exit non-zero if dead keys are found
- `--debug` — log debug information for troubleshooting
- `complete <shell>` — generate shell completion (`bash`, `zsh`, `fish`)

### CI

Fail the pipeline when dead keys accumulate:

```yaml
- name: Check for unused translations
  run: npx i18next-validator --fail-on-dead --format json
```

The `json` and `csv` formats list every dead key with its locale file and line, ready for reporting tooling.

## How it reads your config

The validator parses your init file with [oxc](https://oxc.rs) (no TypeScript compilation needed) and extracts the i18next configuration object — `nsSeparator`, `keySeparator`, `defaultNS`, `fallbackNS`, `preload`, locale import paths, and interpolation settings — then applies those exact rules when matching keys. Dynamic keys built from variables (`t(\`errors.${code}\`)`) are matched structurally, and keys composed across module boundaries (exported constants, shared helpers) are resolved through a cross-file context pass.

## License

[Apache-2.0](https://github.com/comment-team/comment-labs/blob/main/LICENSE)
