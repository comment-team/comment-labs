# @comment-labs/tsdiff

Checks changes in exported type signatures between two TypeScript declaration files, so a public API cannot break silently.

Point it at the `.d.ts` your last release shipped and the one your current build produces: tsdiff reports every exported symbol that was removed, renamed, or whose type is no longer assignable to what consumers already depend on — plus exports that newly leak types the package's `files` never intended to expose. `tsdiff check` exits non-zero on any breaking change, which turns "did we break anyone?" from a code review guess into a gate.

## Installation

```bash
pnpm add -D @comment-labs/tsdiff
```

## Usage

Compare the published declaration file against a candidate build:

```bash
npx tsdiff check dist-v1/index.d.ts dist-v2/index.d.ts
```

- `--tsconfig <path>` — resolve the files against your project's compiler options (paths, aliases) instead of defaults

Non-breaking signature changes are printed as informational changes; breaking ones are printed as errors and set the exit code to `1`.

### CI

Run it between builds, before publishing:

```yaml
- name: Check for breaking type changes
  run: npx tsdiff check previous/index.d.ts dist/index.d.ts
```

## Programmatic API

The CLI is a thin wrapper; the check itself is a library:

```ts
import { isCompatible } from '@comment-labs/tsdiff'

const result = isCompatible({
  base: 'dist-v1/index.d.ts',
  candidate: 'dist-v2/index.d.ts',
  options: { compilerOptions }
})

result.success // false when any exported symbol broke
result.errors // breaking changes, human-readable
result.warnings // suspicious but not provably breaking
result.changes // compatible signature changes
```

## License

[Apache-2.0](https://github.com/comment-team/comment-labs/blob/main/LICENSE)
