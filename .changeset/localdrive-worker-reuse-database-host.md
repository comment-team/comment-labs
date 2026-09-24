---
'@comment-labs/localdrive': patch
---

#### Worker reuse across test files (workerd reuse)

- The file-scope pool worker now answers Vitest's reuse question, so with consumer `test.isolate: false` one workerd instance (and one module registry) serves multiple test files sequentially instead of cold-booting per file.
- Per-file database isolation is preserved: every database the worker owns is reset to a fresh template clone plus `beforeEach` SQL before the next file's work message is forwarded, including after failed files. Connection strings stay stable because resets rebind the same loopback port.
- Inert without consumer opt-in: with `test.isolate: true` (the default) Vitest never consults the worker for reuse and behavior is unchanged.
- New `workerReuse` option (default `true`) to opt out.
- Vitest packs all files into a single worker request when `isolate: false` is combined with `maxWorkers: 1`; localdrive detects this and warns once, since no per-file reset boundary exists in that mode.

#### Database host worker threads

- Each pool worker's PGlite templates, clones, and PostgreSQL wire sockets now run on a dedicated `worker_threads` worker (`databaseHost: 'thread'`, the new default), so SQL from parallel test files no longer blocks the Vitest core thread.
- Templates are transferred once per worker as a PGlite data-directory dump (`dumpDataDir` / `loadDataDir`) and restored with the same extensions, schema, and seed data; clones and resets happen inside the host thread.
- New options: `databaseHost` (`'thread' | 'inline'`), `databaseHostResourceLimits`, and `databaseHostRpcTimeoutMs` (default 60s). RPCs time out, worker crashes reject pending requests, and `databaseHost: 'inline'` restores the previous core-thread behavior.
- No protocol changes: hyperdrive connection strings remain plain `postgresql://` URLs on `127.0.0.1`.

#### Fixes and infrastructure

- The per-file control server is no longer restarted for every file (it is now bound once per pool worker).
- Work messages are serialized per worker so a reset can never be overtaken by the next file's message.
- Template dumps are computed once per binding and cached for the controller's lifetime.
