import process from 'node:process'
import type { Vite, VitestPluginContext } from 'vitest/node'
import { Localdrive } from './localdrive'
import type { LocaldriveConnections, LocaldrivePluginOptions } from './types'


const defaultHyperdrivePrefix = 'CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_'

function getHyperdrivePrefix(hyperdrive: LocaldrivePluginOptions['hyperdrive']): string | undefined {
  if (hyperdrive === undefined || hyperdrive === false) {
    return undefined
  }

  if (hyperdrive === true) {
    return defaultHyperdrivePrefix
  }

  return hyperdrive.envPrefix ?? defaultHyperdrivePrefix
}

export function localdrivePlugin(options: LocaldrivePluginOptions): Vite.Plugin {
  return {
    name: 'localdrive',
    // eslint-disable-next-line typescript/no-misused-promises, typescript/strict-void-return
    async configureVitest(context: VitestPluginContext) {
      const { hyperdrive, ...localdriveOptions } = options
      const controller = new Localdrive(localdriveOptions)
      await controller.initialize()

      const databases = await controller.createTestDatabases()
      const connections: LocaldriveConnections = {}

      for (const [ name, database ] of Object.entries(databases)) {
        connections[name] = database.connectionString
      }

      const prefix = getHyperdrivePrefix(hyperdrive)

      if (prefix !== undefined) {
        for (const [ name, connectionString ] of Object.entries(connections)) {
          process.env[`${prefix}${name}`] = connectionString
        }
      }

      context.project.provide('localdrive', connections)

      context.vitest.onClose(async () => {
        await Promise.all(Object.values(databases).map(async database => await database.close()))
        await controller.close()
      })
    }
  }
}
