import { rm, writeFile } from 'node:fs/promises'
import process from 'node:process'
import type { Fixtures } from '@playwright/test'
import { Localdrive } from './localdrive'
import { resetLocaldriveDatabase } from './query-client'
import type { LocaldriveConnections, LocaldriveOptions } from './types'


export interface LocaldrivePlaywrightSetupOptions {
  /** Path to write a dotenv-compatible file with connection strings. */
  envFile?: string
}

export function localdrivePlaywrightSetup(
  options: LocaldriveOptions,
  setupOptions: LocaldrivePlaywrightSetupOptions = {}
): () => Promise<() => Promise<void>> {
  return async () => {
    const controller = new Localdrive(options)

    await controller.initialize()

    const databases = await controller.createTestDatabases()
    const connections: LocaldriveConnections = Object.fromEntries(
      Object.entries(databases).map(([ name, database ]) => [ name, database.connectionString ])
    )

    const env: Record<string, string> = {
      LOCALDRIVE_CONNECTIONS: JSON.stringify(connections),
      LOCALDRIVE_CONTROL_URL: controller.controlUrl ?? ''
    }

    for (const [ name, connectionString ] of Object.entries(connections)) {
      const key = `LOCALDRIVE_${name}_URL`.toUpperCase()

      env[key] = connectionString
    }

    Object.assign(process.env, env)

    if (setupOptions.envFile !== undefined) {
      const lines = Object.entries(env).map(([ key, value ]) => `${key}=${value}`)

      await writeFile(setupOptions.envFile, lines.join('\n'))
    }

    return async () => {
      if (setupOptions.envFile !== undefined) {
        try {
          await rm(setupOptions.envFile)
        } catch {
          // The env file may already be gone; ignore cleanup errors.
        }
      }

      await controller.close()
    }
  }
}


export interface LocaldrivePlaywrightTestFixtures {
  /** Connection strings for every Localdrive binding. */
  localdriveConnections: LocaldriveConnections
  /** Resets every Localdrive database. Called automatically before each test. */
  resetLocaldrive: () => Promise<void>
}

function parseJson(value: string): unknown {
  return JSON.parse(value)
}

function isLocaldriveConnections(value: unknown): value is LocaldriveConnections {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  return Object.values(value).every(entry => typeof entry === 'string')
}

async function resetFromEnv(): Promise<void> {
  const controlUrl = process.env.LOCALDRIVE_CONTROL_URL

  if (controlUrl === undefined || controlUrl === '') {
    throw new Error('LOCALDRIVE_CONTROL_URL is not set; did you configure localdrivePlaywrightSetup?')
  }

  const rawConnections = process.env.LOCALDRIVE_CONNECTIONS

  if (rawConnections === undefined) {
    throw new Error('LOCALDRIVE_CONNECTIONS is not set; did you configure localdrivePlaywrightSetup?')
  }

  const parsed = parseJson(rawConnections)

  if (!isLocaldriveConnections(parsed)) {
    throw new Error('LOCALDRIVE_CONNECTIONS is not a valid connection map')
  }

  const firstConnection = Object.values(parsed)[0]

  if (firstConnection === undefined) {
    throw new Error('No Localdrive connections are configured')
  }

  // The control server resets every registered database, so any connection
  // string can be used to identify the target controller.
  await resetLocaldriveDatabase(firstConnection, { controlUrl })
}

const fixtures: Fixtures<LocaldrivePlaywrightTestFixtures> = {
  localdriveConnections: [
    async (_, provide) => {
      const raw = process.env.LOCALDRIVE_CONNECTIONS

      if (raw === undefined) {
        throw new Error('LOCALDRIVE_CONNECTIONS is not set; did you configure localdrivePlaywrightSetup?')
      }

      const parsed = parseJson(raw)

      if (!isLocaldriveConnections(parsed)) {
        throw new Error('LOCALDRIVE_CONNECTIONS is not a valid connection map')
      }

      await provide(parsed)
    },
    { scope: 'test' }
  ],

  resetLocaldrive: [
    async (_, provide) => {
      await resetFromEnv()
      await provide(resetFromEnv)
    },
    { scope: 'test', auto: true }
  ]
}

export { fixtures as localdrivePlaywrightFixtures }
