# @comment-labs/localdrive

Local PostgreSQL database clones for testing, backed by [PGlite](https://pglite.dev/). It is designed to emulate [Cloudflare Hyperdrive](https://developers.cloudflare.com/hyperdrive/) bindings inside Vitest, including the `@cloudflare/vitest-pool-workers` pool.

## Install

```sh
pnpm add -D @comment-labs/localdrive
```

Peer dependencies must also be installed:

```sh
pnpm add -D vitest @cloudflare/vitest-pool-workers
```

## Programmatic API

Use the `Localdrive` controller directly when you need low-level control or are not using Vitest.

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

// Each call creates a fresh clone of the migration template.
const databases = await localdrive.createTestDatabases()

await databases.DB.testQuery('SELECT * FROM users')
await databases.DB.close()

await localdrive.close()
```

### `LocaldriveBindingOptions`

| Option           | Description                                                       |
| ---------------- | ----------------------------------------------------------------- |
| `migrations`     | SQL files applied once when the migration template is initialized. |
| `snapshot`       | SQL files applied once after migrations on the template.          |
| `beforeEach`     | SQL files applied to every cloned database before it is used.     |
| `connectionString` | Optional `{ username?, password? }` for the generated URL.      |

## Vitest plugin

`localdrivePlugin()` creates one database clone per binding for an entire Vitest project. The connection strings are provided through Vitest's `inject('localdrive')` API and can be wired into `cloudflareTest()` with `localdrivePoolOptions()`.

```ts
import { localdrivePlugin, localdrivePoolOptions } from '@comment-labs/localdrive/vitest'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    localdrivePlugin({
      bindings: { DB: { migrations: 'drizzle/*.sql' } }
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

## Cloudflare test helper

`@comment-labs/localdrive/cloudflare-test` exports a small client that turns a Hyperdrive binding into a query function, so you don't have to set up a Postgres driver in every test file.

```ts
/// <reference types="@cloudflare/workers-types" />
import { createLocaldriveClient } from '@comment-labs/localdrive/cloudflare-test'
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

function connectionString(binding: string | { connectionString?: string }): string {
  return typeof binding === 'string' ? binding : binding.connectionString ?? ''
}

describe('users', () => {
  it('seeds and reads rows', async () => {
    const db = createLocaldriveClient(connectionString(env.FLAGSHIP_DB))

    try {
      await db.query('INSERT INTO users (name) VALUES ($1)', [ 'alice' ])
      const users = await db.query<{ name: string }>('SELECT name FROM users')

      expect(users).toHaveLength(1)
      expect(users[0]?.name).toBe('alice')
    } finally {
      await db.end()
    }
  })
})
```

The helper uses `postgres` under the hood, so `nodejs_compat` must be enabled.

## Cloudflare test integration

`localdriveCloudflareTest()` is the recommended high-level API for Cloudflare worker tests. It adds a `databaseScope` option that selects between the two lifecycles described below.

### Project scope

One database clone per binding is created when the Vitest project starts and shared by every test file. This matches the manual `localdrivePlugin()` + `cloudflareTest()` composition above.

```ts
import { localdriveCloudflareTest } from '@comment-labs/localdrive/vitest'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    localdriveCloudflareTest({
      bindings: {
        DB: { migrations: 'drizzle/*.sql' }
      },
      databaseScope: 'project',
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

### File scope

A fresh database clone is created for **each test file**. The migration template is still initialized once per project, so only the cheap clone/socket/Hyperdrive layer repeats per file. Files can be run in parallel and safely truncate tables without affecting other files.

```ts
import { localdriveCloudflareTest } from '@comment-labs/localdrive/vitest'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    fileParallelism: true
  },
  plugins: [
    localdriveCloudflareTest({
      bindings: {
        FLAGSHIP_DB: {
          migrations: 'drizzle/*.sql',
          connectionString: { password: 'password' }
        }
      },
      databaseScope: 'file',
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

Inside the worker, the binding behaves like a normal Hyperdrive binding:

```ts
export default {
  async fetch(request: Request, env: Record<string, unknown>): Promise<Response> {
    const binding = env.FLAGSHIP_DB as { connectionString?: string } | string
    const connectionString = typeof binding === 'string' ? binding : binding.connectionString ?? ''

    return new Response(connectionString)
  }
}
```

### Scope comparison

| Scope       | Databases                                            | Best for                                    |
| ----------- | ---------------------------------------------------- | ------------------------------------------- |
| `project`   | One clone per binding, shared by all test files.     | Fastest setup; logical IDs already isolate. |
| `file`      | One clone per binding, created for each test file.   | Parallel files, cleanup, physical isolation.  |

## Cleanup and failures

The integration ensures cleanup with `try`/`finally` semantics:

- Socket servers created for a cloned database are stopped after every file.
- Cloned databases are closed after every file, even if the file fails.
- Migration templates are closed when Vitest shuts down.
- Active clones are tracked and closed on `SIGINT` and `SIGTERM`.

## License

Apache-2.0
