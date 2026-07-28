import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import type { ProvidedContext } from 'vitest'
import type { Vite, VitestPluginContext } from 'vitest/node'
import { Localdrive } from './localdrive'
import { closeActiveDatabases, localdriveCloudflarePool } from './cloudflare-pool'
import { localdrivePlugin } from './plugin'
import { registerLocaldrive, unregisterLocaldrive } from './registry'
import type { LocaldriveCloudflareTestOptions, LocaldriveConnections } from './types'


const hyperdriveLocalPrefix = 'CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_'
const placeholderConnectionString = 'postgresql://placeholder:placeholder@127.0.0.1:5432/postgres'
const newLinePattern = /\r?\n/u
const bindingPattern = /^binding\s*=\s*["'](?<name>[^"']+)["']/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function closeDatabasesOnSignal(): void {
  // eslint-disable-next-line promise/prefer-await-to-then
  closeActiveDatabases().catch(() => {
    // Best-effort cleanup on process termination signals.
  })
}

export function localdriveCloudflareTest(options: LocaldriveCloudflareTestOptions): Vite.PluginOption {
  const { databaseScope = 'file', cloudflare, ...localdriveOptions } = options

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

  return [
    hyperdrivePlaceholderPlugin(localdriveOptions.bindings, cloudflare),
    localdrivePlugin(localdriveOptions),
    cloudflareTest(cloudflareOptions)
  ]
}

function fileScopePlugins(
  localdriveOptions: Omit<LocaldriveCloudflareTestOptions, 'cloudflare' | 'databaseScope'>,
  cloudflare: LocaldriveCloudflareTestOptions['cloudflare']
): Vite.Plugin[] {
  return [
    hyperdrivePlaceholderPlugin(localdriveOptions.bindings, cloudflare),
    cloudflareTest(cloudflare),
    {
      name: 'localdrive-cloudflare-test',
      // eslint-disable-next-line typescript/no-misused-promises, typescript/strict-void-return
      async configureVitest(context: VitestPluginContext) {
        const controller = new Localdrive(localdriveOptions)
        await controller.initialize()

        process.once('SIGINT', closeDatabasesOnSignal)
        process.once('SIGTERM', closeDatabasesOnSignal)

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

function hyperdrivePlaceholderPlugin(
  bindings: LocaldriveCloudflareTestOptions['bindings'],
  cloudflare: LocaldriveCloudflareTestOptions['cloudflare']
): Vite.Plugin {
  return {
    name: 'localdrive-cloudflare-hyperdrive-placeholder',
    // eslint-disable-next-line typescript/no-misused-promises, typescript/strict-void-return
    async configureVitest(context: VitestPluginContext) {
      const bindingNames = await collectHyperdriveBindingNames(bindings, cloudflare)
      const previous = new Map<string, string | undefined>()

      for (const name of bindingNames) {
        const key = `${hyperdriveLocalPrefix}${name}`
        previous.set(key, process.env[key])
        process.env[key] = placeholderConnectionString
      }

      context.vitest.onClose(() => {
        for (const [ key, value ] of previous) {
          process.env[key] = value
        }
      })
    }
  }
}

async function collectHyperdriveBindingNames(
  bindings: LocaldriveCloudflareTestOptions['bindings'],
  cloudflare: LocaldriveCloudflareTestOptions['cloudflare']
): Promise<string[]> {
  const names = new Set(Object.keys(bindings))

  const configPath = getWranglerConfigPath(cloudflare)

  if (configPath !== undefined) {
    for (const name of await readWranglerHyperdriveBindings(configPath)) {
      names.add(name)
    }
  }

  return [ ...names ]
}

function getWranglerConfigPath(cloudflare: LocaldriveCloudflareTestOptions['cloudflare']): string | undefined {
  if (!isRecord(cloudflare)) {
    return undefined
  }

  const wrangler = cloudflare.wrangler

  if (!isRecord(wrangler)) {
    return undefined
  }

  const configPath = wrangler.configPath

  return typeof configPath === 'string' ? configPath : undefined
}

async function readWranglerHyperdriveBindings(configPath: string): Promise<string[]> {
  try {
    const content = await readFile(configPath, 'utf8')

    if (configPath.endsWith('.json')) {
      const parsed = JSON.parse(content) as unknown

      return extractBindingNamesFromJson(parsed)
    }

    return parseTomlHyperdriveBindings(content)
  } catch {
    return []
  }
}

function extractBindingNamesFromJson(parsed: unknown): string[] {
  if (!isRecord(parsed) || !('hyperdrive' in parsed)) {
    return []
  }

  const bindings = parsed.hyperdrive

  if (!Array.isArray(bindings)) {
    return []
  }

  return bindings
    .filter((binding): binding is Record<string, unknown> => isRecord(binding))
    .map(binding => binding.binding)
    .filter((name): name is string => typeof name === 'string')
}

function parseTomlHyperdriveBindings(content: string): string[] {
  const names: string[] = []
  const lines = content.split(newLinePattern)
  let inBlock = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed === '[[hyperdrive]]') {
      inBlock = true
      continue
    }

    if (inBlock && (trimmed.startsWith('['))) {
      inBlock = false

      if (trimmed === '[[hyperdrive]]') {
        inBlock = true
        continue
      }
    }

    if (inBlock) {
      const match = bindingPattern.exec(trimmed)
      const bindingName = match?.groups?.name

      if (bindingName !== undefined) {
        names.push(bindingName)
      }
    }
  }

  return names
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
