/**
 * Shared state + image handling for the image-viewer plugin.
 * Framework-agnostic — the V2 adapter uses this.
 *
 * The vision model is NOT configured here: the plugin switches the vision
 * session onto the `image-viewer` agent, and whatever model that agent block
 * declares in the user's opencode config is what answers.
 */
import { access, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import process from 'node:process'

export type ImageViewerOptions = {
  disabled?: boolean
}

export const AGENT_NAME = 'image-viewer'
export const MAX_IMAGES = 6
// opencode attachments cap at ~5MB base64 (~3.9MB raw); fail fast with a clear message
export const MAX_FILE_BYTES = 3_800_000
export const MIMES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

export const STATE_FILE = path.join(
  process.env.XDG_DATA_HOME ?? path.join(process.env.HOME ?? '', '.local/share'),
  'opencode',
  'image-viewer-state.json'
)

export type ImageView = { sessionID: string; images: Array<{ path: string; mime: string }> }
export type ViewMap = Record<string, ImageView>

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isImageView(value: unknown): value is ImageView {
  if (!isPlainObject(value) || typeof value.sessionID !== 'string' || !Array.isArray(value.images)) {
    return false
  }

  return value.images.every(img => isPlainObject(img) && typeof img.path === 'string' && typeof img.mime === 'string')
}

function parseViewMap(value: unknown): ViewMap {
  if (!isPlainObject(value)) {
    return {}
  }

  const result: ViewMap = {}

  for (const [ key, entry ] of Object.entries(value)) {
    if (isImageView(entry)) {
      result[key] = entry
    }
  }

  return result
}

let state: ViewMap | null = null
let pendingSave: Promise<void> = Promise.resolve()

export async function loadViews(): Promise<ViewMap> {
  if (state !== null) {
    return state
  }

  try {
    // oxlint-disable-next-line unicorn-js/no-top-level-assignment-in-function -- module-level cache, deliberate
    state = parseViewMap(JSON.parse(await readFile(STATE_FILE, 'utf8')))
  } catch {

    // oxlint-disable-next-line unicorn-js/no-top-level-assignment-in-function -- module-level cache, deliberate
    state = {}
  }

  return state
}

/**
 * Atomic persist (tmp+rename) so a restart never loses view mappings.
 * Saves are serialized through the pendingSave chain.
 */
export function saveViews(snapshot: ViewMap): void {
  // oxlint-disable-next-line unicorn-js/no-top-level-assignment-in-function -- save serialization chain, deliberate
  pendingSave = runSave(pendingSave, snapshot)
}

async function runSave(previous: Promise<void>, snapshot: ViewMap): Promise<void> {
  try {
    await previous
  } catch {
    // a failed previous save doesn't block this one
  }

  try {
    await mkdir(path.dirname(STATE_FILE), { recursive: true })

    const tmp = `${STATE_FILE}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(snapshot))
    await rename(tmp, STATE_FILE)
  } catch {
    // best-effort; in-memory state still works for this server run
  }
}

export type PreparedImages = {
  fresh: Array<{ path: string; mime: string }>
  added: string[]
  skipped: string[]
  view: ImageView
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)

    return true
  } catch {
    return false
  }
}

/**
 * Validate + accumulate new images into the session's view (shared rules:
 * known extension, exists, size cap, MAX_IMAGES per session).
 */
export async function prepareImages(
  sessionID: string,
  requested: string[] | undefined,
  base: string
): Promise<PreparedImages> {
  const views = await loadViews()
  const view: ImageView = views[sessionID] ?? { sessionID: '', images: [] }
  const fresh: Array<{ path: string; mime: string }> = []
  const added: string[] = []
  const skipped: string[] = []

  for (const raw of requested ?? []) {
    const abs = path.resolve(base, raw)
    if (view.images.some(i => i.path === abs) || fresh.some(i => i.path === abs)) {
      skipped.push(abs)
      continue
    }

    const mime = MIMES[path.extname(abs).toLowerCase()]
    if (mime === undefined) {
      throw new Error(`unsupported image type: ${abs} (supported: png, jpg, jpeg, gif, webp)`)
    }

    if (!await pathExists(abs)) {
      throw new Error(`image not found: ${abs}`)
    }

    if ((await stat(abs)).size > MAX_FILE_BYTES) {
      throw new Error(`image too large (>3.8MB): ${abs}`)
    }

    fresh.push({ path: abs, mime })
  }

  if (view.images.length + fresh.length > MAX_IMAGES) {
    throw new Error(
      `image limit reached: max ${MAX_IMAGES} images per session (already ${view.images.length}); adding ${fresh.length} would exceed it — drop some or ask a followup instead`
    )
  }

  view.images.push(...fresh)
  added.push(...fresh.map(i => i.path))

  if (view.images.length === 0) {
    throw new Error('no images in this session\'s view — pass an `images` array first, then ask followups without it')
  }

  // persist the mutated view (callers re-save after assigning sessionID —
  // same object reference, so the second save just repeats atomically)
  views[sessionID] = view
  saveViews(views)

  return { fresh, added, skipped, view }
}

/**
 * Extract the assistant text from a vision-session response.
 */
export function answerFromParts(parts?: Array<Record<string, unknown>>): string {
  return (parts ?? [])
    .filter(p => p.type === 'text')
    .map(p => (typeof p.text === 'string' ? p.text : ''))
    .join('\n')
    .trim()
}

export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
