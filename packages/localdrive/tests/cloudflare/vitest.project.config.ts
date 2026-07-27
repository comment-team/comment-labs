import { localdriveCloudflareTest } from '../../src/vitest'
import { defineConfig } from 'vitest/config'


export default defineConfig({
  plugins: [
    localdriveCloudflareTest({
      bindings: {
        FLAGSHIP_DB: {
          migrations: 'tests/cloudflare/migrations/*.sql',
          connectionString: { password: 'password' }
        }
      },
      databaseScope: 'project',
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
