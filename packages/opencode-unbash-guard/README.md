# @comment-labs/opencode-unbash-guard

opencode plugin that keeps bash honest (OpenCode 2: `Plugin.define`/`setup()`).

- Parses every bash command with [unbash](https://github.com/lukeed/unbash) and blocks
  read/write-tool bypasses (`cat`/`head`/`sed` on files, `echo >` redirects, `sed -i`),
  command chaining (`a && b`, `a; b`) and file searches via `grep`/`rg` — with a
  carve-out for piping command *output* through them.
- Quietly rewrites verbose invocations: `git` → `--no-pager -c color.ui=false`,
  unbounded `git log` → `--oneline -n 30`, bare `git status` → `-sb`, bare
  `npm ls` → `--depth=0`, `curl` → `-sS`.
- Replaces the builtin `grep` tool with a tgrep-backed one (trigram index,
  auto-built/refreshed per git repo, 100-match cap, builtin-style output).

Fails open: parse errors never block, rewrites are skipped on dirty parses.
