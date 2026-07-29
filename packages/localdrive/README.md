# @comment-labs/localdrive

Fresh, isolated local PostgreSQL databases for tests. It uses [PGlite](https://pglite.dev/) under the hood so you can run real PostgreSQL queries without installing or configuring a server, and it exposes the databases as [Cloudflare Hyperdrive](https://developers.cloudflare.com/hyperdrive/)-style bindings inside Vitest.

Use it when:

- Your tests need a real PostgreSQL-compatible engine, but you want them to start instantly and clean up automatically.
- You write Cloudflare Worker tests with `@cloudflare/vitest-pool-workers` and need Hyperdrive bindings that point to real, isolated databases.
- You want each test file to get its own database clone without setting up Docker.

## Install

```sh
pnpm add -D @comment-labs/localdrive
```

Peer dependencies must also be installed:

```sh
pnpm add -D vitest
```

For Cloudflare Worker tests you will also need `@cloudflare/vitest-pool-workers` and `nodejs_compat` enabled.

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
| `snapshot`         | `string \| string[]`                              | SQL files applied once after migrations on the template.                            |
| `beforeEach`       | `string \| string[]`                              | SQL files applied to every cloned database before it is used.                     |
| `connectionString` | `{ username?: string; password?: string }`      | Optional credentials to include in the generated connection string.                 |

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
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
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
          migrations: 'drizzle/*.sql',
          connectionString: { password: 'password' }
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

## Query helper

`@comment-labs/localdrive/cloudflare-test` exports `createLocaldriveClient()`, a tiny wrapper around `postgres` that lets you run raw SQL inside your Cloudflare Worker tests:

```ts
/// <reference types="@cloudflare/vitest-pool-workers/types" />
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
