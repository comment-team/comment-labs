import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import type { ProvidedContext } from 'vitest'
import type { Vite, VitestPluginContext } from 'vitest/node'
import { Localdrive } from './localdrive'
import { localdriveCloudflarePool } from './cloudflare-pool'
import { localdrivePlugin } from './plugin'
import { registerLocaldrive, unregisterLocaldrive } from './registry'
import type { LocaldriveCloudflareTestOptions, LocaldriveConnections } from './types'


export function localdriveCloudflareTest(options: LocaldriveCloudflareTestOptions): Vite.PluginOption {
  const { databaseScope = 'project', cloudflare, ...localdriveOptions } = options

  if (databaseScope === 'project') {
    return projectScopePlugins(localdriveOptions, cloudflare)
  }

  return fileScopePlugins(localdriveOptions, cloudflare)
}

function projectScopePlugins(
  localdriveOptions: Omit<LocaldriveCloudflareTestOptions, 'cloudflare' | 'databaseScope'>,
  cloudflare: LocaldriveCloudflareTestOptions['cloudflare']
): Vite.Plugin[] {
  const cloudflareOptions = typeof cloudflare === 'function'
    ? async (context: InjectContext): Promise<ResolvedCloudflareTestOptions> => {
      const resolved = await cloudflare(context)

      return mergeHyperdrives(resolved, context.inject('localdrive'))
    }
    : (context: InjectContext): ResolvedCloudflareTestOptions =>
      mergeHyperdrives(cloudflare, context.inject('localdrive'))

  return [ localdrivePlugin(localdriveOptions), cloudflareTest(cloudflareOptions) ]
}

function fileScopePlugins(
  localdriveOptions: Omit<LocaldriveCloudflareTestOptions, 'cloudflare' | 'databaseScope'>,
  cloudflare: LocaldriveCloudflareTestOptions['cloudflare']
): Vite.Plugin[] {
  return [
    cloudflareTest(cloudflare),
    {
      name: 'localdrive-cloudflare-test',
      // eslint-disable-next-line typescript/no-misused-promises, typescript/strict-void-return
      async configureVitest(context: VitestPluginContext) {
        const controller = new Localdrive(localdriveOptions)
        await controller.initialize()

        registerLocaldrive(context.project.name, controller)
        context.project.config.pool = 'localdrive-cloudflare-pool'
        context.project.config.poolRunner = localdriveCloudflarePool({
          bindings: localdriveOptions.bindings,
          cloudflare
        })

        context.vitest.onClose(async () => {
          unregisterLocaldrive(context.project.name)
          await controller.close()
        })
      }
    }
  ]
}

function mergeHyperdrives(
  options: ResolvedCloudflareTestOptions,
  connections: LocaldriveConnections
): ResolvedCloudflareTestOptions {
  return {
    ...options,
    miniflare: {
      ...options.miniflare,
      hyperdrives: {
        ...options.miniflare?.hyperdrives,
        ...connections
      }
    }
  }
}

type InjectContext = {
  inject: <K extends keyof ProvidedContext>(key: K) => ProvidedContext[K]
}

type CloudflareTestOptions = Parameters<typeof cloudflareTest>[0]
type CloudflareTestFunction = Extract<CloudflareTestOptions, (...args: never[]) => unknown>
type ResolvedCloudflareTestOptions = Awaited<ReturnType<CloudflareTestFunction>>
