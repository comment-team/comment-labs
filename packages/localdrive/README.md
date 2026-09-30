# @comment-labs/localdrive

Fresh, isolated local PostgreSQL databases for tests. It uses [PGlite](https://pglite.dev/) under the hood so you can run real PostgreSQL queries without installing or configuring a server, and it exposes the databases as [Cloudflare Hyperdrive](https://developers.cloudflare.com/hyperdrive/)-style bindings inside Vitest.

Use it when:

- Your tests need a real PostgreSQL-compatible engine, but you want them to start instantly and clean up automatically.
- You write Cloudflare Worker tests with `@cloudflare/vitest-plugin` and need Hyperdrive bindings that point to real, isolated databases.
- You want each test file to get its own database clone without setting up Docker.

## Install

```sh
pnpm add -D @comment-labs/localdrive
```

Peer dependencies must also be installed:

```sh
pnpm add -D vitest
```

For Cloudflare Worker tests you will also need `@cloudflare/vitest-plugin` and `nodejs_compat` enabled.

## Programmatic API

Use the `Localdrive` controller directly when you are not using the Vitest plugin or need full control over the lifecycle.

```ts
import { Localdrive } from '@comment-labs/localdrive'

const localdrive = new Localdrive({
  bindings: {
    DB: {
      migrations: 'drizzle/*.sql',
      snapshot: 'seed.sql',
      beforeEach: 'truncate.sql'
    }
  }
})

await localdrive.initialize()

// Each call returns a fresh clone of the migration template.
const databases = await localdrive.createTestDatabases()

const rows = await databases.DB.testQuery<{ name: string }>('SELECT name FROM users')

await databases.DB.close()
await localdrive.close()
```

### `LocaldriveOptions`

| Option     | Type                                       | Description                                                              |
| ---------- | ------------------------------------------ | ------------------------------------------------------------------------ |
| `bindings` | `Record<string, LocaldriveBindingOptions>` | Required. One entry for each database you want to expose.                |
| `cwd`      | `string`                                   | Base directory for relative migration/snapshot paths. Defaults to `cwd`. |

### `LocaldriveBindingOptions`

| Option             | Type                                              | Description                                                                         |
| ------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `migrations`       | `string \| string[]`                              | SQL files applied once to build the template database.                            |
| `seed`             | `string \| string[]`                              | SQL files applied once after migrations to populate the template with data.        |
| `snapshot`         | `string \| string[]`                              | Deprecated alias for `seed`.                                                        |
| `beforeEach`       | `string \| string[]`                              | SQL files applied to every cloned database before it is used.                     |

### `Localdrive` methods

| Method                  | Returns                              | Description                                              |
| ----------------------- | ------------------------------------ | -------------------------------------------------------- |
| `initialize()`          | `Promise<void>`                      | Applies migrations and snapshots once.                   |
| `createTestDatabases()` | `Promise<Record<string, LocaldriveDatabase>>` | Creates a fresh clone for every binding.                |
| `close()`               | `Promise<void>`                      | Shuts down the template database and cleans up sockets. |

A `LocaldriveDatabase` gives you:

- `connectionString` — the full PostgreSQL URL for the clone.
- `testQuery<T>(query, params?)` — a small helper that runs a query and returns typed rows.
- `close()` — closes that clone.

## Vitest plugin

`localdrivePlugin()` creates one database clone per binding for the whole Vitest project. Connection strings are exposed through Vitest's `inject('localdrive')` context and can be wired into `cloudflareTest()` with `localdrivePoolOptions()`.

```ts
import { localdrivePlugin, localdrivePoolOptions } from '@comment-labs/localdrive/vitest'
import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    localdrivePlugin({
      bindings: {
        DB: { migrations: 'drizzle/*.sql' }
      }
    }),
    cloudflareTest(({ inject }) => ({
      main: './src/index.ts',
      miniflare: {
        compatibilityDate: '2026-02-01',
        compatibilityFlags: [ 'nodejs_compat' ],
        ...localdrivePoolOptions(inject).miniflare
      }
    }))
  ]
})
```

A shortcut `localdrive(options)` is also exported from `@comment-labs/localdrive/vitest` for one-line creation.

## Cloudflare test integration

`localdriveCloudflareTest()` is the recommended high-level helper for Cloudflare Worker tests. It composes `localdrivePlugin()`, `cloudflareTest()`, and the file-scope pool for you.

```ts
import { localdriveCloudflareTest } from '@comment-labs/localdrive/vitest'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    localdriveCloudflareTest({
      bindings: {
        FLAGSHIP_DB: {
          migrations: 'drizzle/*.sql'
        }
      },
      cloudflare: {
        main: './src/index.ts',
        miniflare: {
          compatibilityDate: '2026-02-01',
          compatibilityFlags: [ 'nodejs_compat' ]
        }
      }
    })
  ]
})
```

You can also point it at a Wrangler config instead of defining `main`/`miniflare`:

```ts
localdriveCloudflareTest({
  bindings: {
    FLAGSHIP_DB: { migrations: 'drizzle/*.sql' }
  },
  cloudflare: {
    wrangler: { configPath: './wrangler.toml' }
  }
})
```

Localdrive reads the Wrangler file and sets a temporary `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_<binding>` placeholder for every Hyperdrive binding it finds, so Wrangler config validation passes. The real per-project or per-file URL is still injected before Miniflare starts.

### `databaseScope`

- `"file"` (default) — a fresh clone is created for each test file. Use this for parallel files or when you want physical isolation between files.
- `"project"` — one clone per binding shared by every test file. Fastest setup when your tests do not conflict.

When using `"file"`, the whole test file still shares the same clone, so use UUIDs for rows or reset state between tests:

```ts
import { SELF } from 'cloudflare:test'
import { afterEach, describe, it } from 'vitest'

describe('users', () => {
  afterEach(async () => {
    await SELF.fetch(new Request('http://localhost/reset', { method: 'POST' }))
  })

  it('creates a user', async () => {
    // ...
  })
})
```

Expose a matching endpoint in your Worker to truncate or reset the tables you touch during tests.

### Worker reuse with `test.isolate: false`

By default Vitest starts a fresh Cloudflare pool worker (a new workerd process and module registry) for every test file, and every file pays a cold workerd boot plus a cold evaluation of your module graph. Set `test.isolate: false` in your Vitest config and localdrive reuses one pool worker across files instead:

```ts
export default defineConfig({
  test: {
    isolate: false
  },
  plugins: [
    localdriveCloudflareTest({
      bindings: { FLAGSHIP_DB: { migrations: 'drizzle/*.sql' } },
      cloudflare: { /* ... */ }
    })
  ]
})
```

What this changes — and what it deliberately does not:

- **Per-file database isolation is preserved.** Before each file's work message is forwarded to workerd, every database the worker owns is reset to a fresh template clone plus its `beforeEach` SQL, exactly like a brand new worker. Cross-file queries can never observe another file's rows, tables, or sequence state, regardless of scheduling order or of files failing mid-test.
- **The module registry is shared between files paired on the same worker**, which is Vitest's documented `isolate: false` behavior with plain `@cloudflare/vitest-plugin` too. Module-level state leaks between files that share a runner; if your tests rely on pristine module state, keep `isolate: true` (the default) and forgo the reuse speedup.
- **Keep `maxWorkers` above 1.** Vitest packs every file into a single worker request when `test.isolate: false` is combined with a single worker, and there is no per-file message boundary left to reset at; the databases and the module registry are shared between the packed files and localdrive prints a one-time warning. Any value above 1 (the default scales with your CPU count) keeps one file per request.
- Nothing about the contract is activated unless you opt in: with the default `isolate: true`, Vitest never asks localdrive whether its worker can be reused, and every file still gets a fresh workerd and fresh databases.

### Pool worker options

| Option                         | Type               | Default    | Description                                                                                                            |
| ------------------------------ | ------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| `workerReuse`                  | `boolean`          | `true`     | Lets Vitest reuse one pool worker across files. Inert without consumer `test.isolate: false`.                          |
| `databaseHost`                 | `'thread' \| 'inline'` | `'thread'` | Where each pool worker's PGlite instances and socket servers run.                                                      |
| `databaseHostResourceLimits`   | `object`            | -          | `resourceLimits` passed to the database host `worker_threads` Worker (thread mode only).                                |
| `databaseHostRpcTimeoutMs`     | `number`            | `60_000`   | Timeout for one request to the database host thread: create, reset, query, or close (thread mode only).                |

```ts
localdriveCloudflareTest({
  bindings: { FLAGSHIP_DB: { migrations: 'drizzle/*.sql' } },
  workerReuse: true,
  databaseHost: 'thread',
  databaseHostResourceLimits: { maxOldGenerationSizeMb: 512 },
  databaseHostRpcTimeoutMs: 120_000,
  cloudflare: { /* ... */ }
})
```

- **`databaseHost: 'thread'` (default)** moves every pool worker's PGlite template clones, database clones, and PostgreSQL wire sockets into a dedicated `worker_threads` worker, so SQL from parallel test files runs on separate threads instead of blocking the Vitest core thread. The template travels to the host thread once per worker as a PGlite data-directory dump and is restored there with the exact same extensions, schema, and seed data the core thread built; clones and resets happen inside the host thread afterwards. Set `databaseHost: 'inline'` to fall back to the pre-thread behavior where everything runs on the core thread.
- The connection strings stay plain `postgresql://…` URLs on `127.0.0.1`, so nothing changes for workerd or consumer code.

### Security notes

- Every localdrive surface binds to loopback only: the PostgreSQL wire sockets and the HTTP control server listen on `127.0.0.1`.
- The control server (`LOCALDRIVE_CONTROL_URL`) has no authentication. Any local process — and any page open in your developer browser, since plain HTTP loopback is reachable from web origins — can trigger a reset of the registered databases. Do not enable port forwarding for localdrive ports, and treat localdrive URLs as test-only credentials.
- Database host worker threads are plain Node workers; their `resourceLimits` can be capped with `databaseHostResourceLimits`.

### Accessing the binding inside the Worker

The binding is passed to the Worker like a normal Hyperdrive binding:

```ts
export default {
  async fetch(request: Request, env: Record<string, unknown>): Promise<Response> {
    const binding = env.FLAGSHIP_DB as { connectionString?: string } | string
    const connectionString = typeof binding === 'string' ? binding : binding.connectionString ?? ''

    return new Response(connectionString)
  }
}
```

## Playwright integration

Use Localdrive for end-to-end tests where a Playwright browser talks to a local server that needs a real database.

### 1. Start Localdrive before Playwright

`localdrivePlaywrightSetup()` is a Playwright `globalSetup` that creates the database, exposes its connection strings, and writes them to an environment file so your `webServer` command can read them:

```ts
// playwright.config.ts
import { localdrivePlaywrightSetup, localdrivePlaywrightFixtures } from '@comment-labs/localdrive/playwright'
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  globalSetup: localdrivePlaywrightSetup(
    {
      bindings: {
        DB: {
          migrations: 'drizzle/*.sql',
          seed: 'seed.sql'
        }
      }
    },
    { envFile: '.localdrive.env' }
  ),

  webServer: {
    command: 'dotenv -e .localdrive.env -- wrangler dev',
    url: 'http://127.0.0.1:8787'
  },

  use: {
    baseURL: 'http://127.0.0.1:8787'
  },

  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] }
  ]
})
```

### 2. Reset the database before each test

```ts
import { test as base } from '@playwright/test'
import { localdrivePlaywrightFixtures } from '@comment-labs/localdrive/playwright'

export const test = base.extend(localdrivePlaywrightFixtures)

test('creates an item', async ({ page }) => {
  await page.goto('/items')
  // The database was reset before this test started.
})
```

`resetLocaldrive` is called automatically before every test. It also works as a manual fixture if a test needs to reset in the middle of a flow:

```ts
test('with explicit reset', async ({ page, resetLocaldrive }) => {
  await resetLocaldrive()
  // ...
})
```

Environment variables written by `localdrivePlaywrightSetup`:

- `LOCALDRIVE_CONNECTIONS` — JSON map of binding names to connection strings.
- `LOCALDRIVE_CONTROL_URL` — URL the fixture uses to issue resets.
- `LOCALDRIVE_<BINDING>_URL` — connection string for an individual binding (useful for `wrangler.toml` vars).

## Query helper

`@comment-labs/localdrive/cloudflare-test` exports `createLocaldriveClient()`, a tiny wrapper around `postgres` that lets you run raw SQL inside your Cloudflare Worker tests:

```ts
/// <reference types="@cloudflare/vitest-plugin/types" />
import { createLocaldriveClient } from '@comment-labs/localdrive/cloudflare-test'
import { env } from 'cloudflare:test'
import { expect, it } from 'vitest'

const db = createLocaldriveClient(env.DB)

it('has the expected rows in the database', async () => {
  const rows = await db.query<{ name: string }>('SELECT name FROM users')

  expect(rows).toHaveLength(1)
  expect(rows[0]?.name).toBe('alice')
})
```

The helper caches one `postgres` connection per binding and keeps it open for the lifetime of the test file. Calling `.end()` inside a Worker test is a no-op; the connection is closed automatically when the file-scope database shuts down.

For Node-side tests, use `@comment-labs/localdrive/query` instead. It has the same API but closes the connection when you call `.end()`.

## Stopping

When using the programmatic API, call `controller.close()` after your tests finish. This closes every clone and shuts down the template database. The Vitest plugin and `localdriveCloudflareTest()` handle this for you.

## License

Apache-2.0
