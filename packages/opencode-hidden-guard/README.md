# @comment-labs/opencode-hidden-guard

Blocks agent reads of hidden (dot) files — `.env`, `.ssh`, token files, any
basename starting with `.` — at two layers:

- **Tool layer**: any tool argument that references a hidden file path
  (`read`/`glob`/`ls`/`grep` path args, nested paths).
- **Bash layer**: any bash command whose positional file arguments include a
  hidden file (parsed with [unbash](https://github.com/lukeed/unbash), so
  flags, env prefixes and substitutions are handled).

Prose fields (`text`, `description`) are exempt — mentioning `.env` in a
question is fine. Options: `{ allow: string[], disabled: boolean }`
(allow-lists specific basenames). Fails open on bash parse errors.
