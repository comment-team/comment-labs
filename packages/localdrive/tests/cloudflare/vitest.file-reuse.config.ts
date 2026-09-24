import { localdriveCloudflareTest } from '../../src/vitest'
import { defineConfig } from 'vitest/config'


// Covers the activated consumer contract: `test.isolate: false` lets Vitest
// reuse one pool worker (one workerd, one module registry) across files, and
// localdrive restores per-file database isolation by resetting the databases
// before every file's work message.
//
// NOTE: Vitest packs every file into a single worker request when
// `test.isolate: false` is combined with a single worker, which would skip
// the per-file reset boundary entirely. maxWorkers must stay above 1 here.
export default defineConfig({
  test: {
    fileParallelism: true,
    isolate: false,
    maxWorkers: 2,
    include: [ 'tests/cloudflare/file-reuse-*.test.ts' ]
  },
  plugins: [
    localdriveCloudflareTest({
      bindings: {
        FLAGSHIP_DB: {
          migrations: 'tests/cloudflare/migrations/*.sql',
          snapshot: 'tests/cloudflare/snapshot.sql',
          beforeEach: 'tests/cloudflare/before-each.sql'
        }
      },
      databaseScope: 'file',
      cloudflare: {
        main: './tests/cloudflare/src/index.ts',
        miniflare: {
          compatibilityDate: '2026-02-01',
          compatibilityFlags: [ 'nodejs_compat' ]
        }
      }
    })
  ]
})
