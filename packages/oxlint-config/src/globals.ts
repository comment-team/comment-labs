import globalsPkg from 'globals'
import type { OxlintGlobals } from 'oxlint'
import { enableMode } from './utils'


const convertGlobals = (input: Record<string, boolean>): OxlintGlobals => {
  const result: Record<string, 'readonly' | 'writable'> = {}

  for (const [ key, value ] of Object.entries(input)) {
    result[key] = value ? 'writable' : 'readonly'
  }

  return result as OxlintGlobals
}

const base: OxlintGlobals = convertGlobals(globalsPkg['shared-node-browser'])

const cloudflareSpecificGlobals: OxlintGlobals = {
  Cloudflare: 'readonly',
  URLPattern: 'readonly',
  FixedLengthStream: 'readonly',
  IdentityTransformStream: 'readonly',
  HTMLRewriter: 'readonly',
  WebSocketPair: 'readonly',
  WebSocketRequestResponsePair: 'readonly'
}

const cloudflare: OxlintGlobals = {
  ...base,
  ...cloudflareSpecificGlobals
}

const { Cloudflare: _, ...cloudflareWithoutCF } = cloudflare
const astro: OxlintGlobals = {
  ...cloudflareWithoutCF,
  Astro: 'readonly'
}

async function getGlobals(): Promise<OxlintGlobals> {
  const isAstro = await enableMode(
    [ 'astro.config.ts', 'astro.config.mjs', 'astro.config.js' ],
    [ 'astro' ]
  )

  if (isAstro) {
    return astro
  }

  const isCloudflare = await enableMode(
    [ 'wrangler.toml', 'wrangler.json', 'wrangler.jsonc' ],
    [ '@cloudflare/workers-types', 'wrangler' ]
  )

  if (isCloudflare) {
    return cloudflare
  }

  return base
}

export const globals = await getGlobals()
