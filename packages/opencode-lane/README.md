# @comment-labs/opencode-lane

Makes [lane](https://lane.lukeed.com) the worktree backend for opencode and
keeps agents off raw `git worktree`. Three jobs:

- **Worktree strategy**: opencode's worktree create/remove/discovery route
  through the lane CLI, so every tree opencode creates is a copy-on-write
  clone with warm caches.
- **lane-guard**: bash `git worktree add/remove/move/lock/unlock/repair` is
  blocked (parsed with [unbash](https://github.com/lukeed/unbash), so flags,
  env prefixes and chains are handled). Read-only `git worktree list` and
  registry hygiene `git worktree prune` stay allowed.
- **lane tools**: `lane-health`, `lane_create`, `lane_list`, `lane_switch`.
  `lane_switch` moves the session working directory exactly like the internal
  mechanism of `/cd` (`session.move`) and refuses to switch until the user
  has approved the target through a `question` tool answer in the same
  session — the only interactive approval channel a plugin tool has.

Options: `{ disabled: boolean, lanePath: string }` — `lanePath` overrides the
lane binary location (default `~/.local/bin/lane`).

## Source layout

- `src/core.ts` — pure logic (guard detection, name/resolution rules,
  approval scan, inventory parsing); no opencode imports, tested directly.
- `src/index.ts` — plugin wiring (`Plugin.define`, hooks, tools, strategy).
- `tests/lane.test.ts` — vitest suite against the core.

## Build and publish

`pnpm build` (tsdown) produces `dist/index.mjs` + `dist/index.d.mts`.
`main`/`exports` point at `dist/` and `files` ships only `dist/`, so the
published package resolves on its own — the repo is pure TypeScript with
no root entry file. Use the published package by adding
`"@comment-labs/opencode-lane"` to opencode's `plugins` array (entries
accept package names or directories, not files).
