/**
 * V2 adapter (OpenCode 2): viewimage tool via ctx.tool.transform; the vision
 * subagent is prompted through the documented domain APIs —
 * ctx.session.create + switchAgent + prompt({ text, files }).
 */
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import process from 'node:process'
import { Plugin } from '@opencode/plugin'
import {
  AGENT_NAME,
  answerFromParts,
  errText,
  loadViews,
  prepareImages,
  saveViews
} from './state'


const SESSION_GONE_REGEX = /not found|404/u
const SESSION_BUSY_REGEX = /busy/iu

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isPartList(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.every(item => isPlainObject(item))
}

function readGuardOptions(value: unknown): { disabled?: boolean } {
  if (typeof value !== 'object' || value === null) {
    return {}
  }

  const options: { disabled?: boolean } = {}
  if ('disabled' in value && typeof value.disabled === 'boolean') {
    options.disabled = value.disabled
  }

  return options
}

function isViewImageInput(input: unknown): input is { images?: unknown[]; question: string } {
  if (typeof input !== 'object' || input === null || !('question' in input) || typeof input.question !== 'string') {
    return false
  }

  return !('images' in input) || Array.isArray(input.images)
}

function asMessageList(value: unknown): Array<Record<string, unknown>> | undefined {
  return isPartList(value) ? value : undefined
}

/**
 * Last assistant text in the session's message context, skipping our own
 * echoed question. Tolerates both {parts:[{type:"text",text}]} and flat
 * {text} message shapes; verifies the real shape in e2e.
 */
function lastAssistantText(msgs: Array<Record<string, unknown>> | undefined, question: string): string {
  for (let i = (msgs?.length ?? 0) - 1; i >= 0; i--) {
    const m = msgs?.[i]
    if (m === undefined) {
      continue
    }

    let parts: Array<Record<string, unknown>> | undefined
    if (isPartList(m.parts)) {
      parts = m.parts
    } else if (isPartList(m.content)) {
      parts = m.content
    } else if (typeof m.text === 'string') {
      parts = [{ type: 'text', text: m.text }]
    }

    const text = answerFromParts(parts)
    if (text !== '' && text.trim() !== question.trim()) {
      return text
    }
  }

  return ''
}

export const v2def = () =>
  Plugin.define({
    id: 'image-viewer',
    async setup(ctx) {
      const options = readGuardOptions(ctx.options)
      if (options.disabled === true) {
        return
      }

      await ctx.tool.transform(editor => {
        editor.add({
          name: 'viewimage',
          description: [
            '- View image files by asking a vision subagent on your behalf',
            '- Use this whenever you need to SEE an image (screenshot, photo, diagram, UI mock) that you cannot view directly',
            '- First call: pass `images` (absolute paths) and a `question` about them',
            '- Followups: call again with just a `question` — the vision session ',
            'remembers all images, nothing is re-sent',
            '- Images accumulate per session (max 6 total)',
            '- Returns the vision model\'s answer'
          ].join('\n'),
          input: {
            type: 'object',
            properties: {
              images: {
                type: 'array',
                items: { type: 'string' },
                description: 'Absolute paths of image files (png/jpg/jpeg/gif/webp) to add to this session\'s view. Omit for followup questions.'
              },
              question: {
                type: 'string',
                description: 'What to ask the vision subagent about the images (or a followup question)'
              }
            },
            required: [ 'question' ],
            additionalProperties: false
          },
          async execute(input, context) {
            if (!isViewImageInput(input)) {
              throw new Error('invalid viewimage input: question must be a string')
            }

            const images = Array.isArray(input.images) ? input.images.filter((item): item is string => typeof item === 'string') : undefined
            const { added, view } = await prepareImages(context.sessionID, images, process.cwd())

            if (view.sessionID === '') {
              const created = await ctx.session.create({ title: 'image view (vision subagent)' })
              // ctx.session.create's plugin-API typing is loose here; the runtime guard covers both shapes
              // oxlint-disable-next-line typescript/no-unnecessary-condition
              view.sessionID = typeof created?.id === 'string' ? created.id : ''
              if (view.sessionID === '') {
                throw new Error('failed to create vision subagent session')
              }

              // the agents.image-viewer block in the user's opencode config
              // carries the vision model — the plugin never picks one itself
              await ctx.session
                .switchAgent({ sessionID: view.sessionID, agent: AGENT_NAME })
                .catch(() => { /* best-effort: agent switching is advisory */ })
            }

            const views = await loadViews()
            views[context.sessionID] = view
            saveViews(views)

            const files: Array<{ uri: string; name: string }> = []

            for (const img of view.images) {
              // followups: images already live in the vision session history
              if (!added.includes(img.path)) {
                continue
              }

              const data = await readFile(img.path)
              files.push({ uri: `data:${img.mime};base64,${data.toString('base64')}`, name: path.basename(img.path) })
            }

            try {
              await ctx.session.prompt({
                sessionID: view.sessionID,
                text: input.question,
                ...(files.length > 0 && { files })
              })

              // the prompt returns the admitted user message; the assistant's
              // answer lands after the run completes
              await ctx.session.wait({ sessionID: view.sessionID })

              const msgs = asMessageList(await ctx.session.context({ sessionID: view.sessionID }))
              const answer = lastAssistantText(msgs, input.question)
              if (answer === '') {
                throw new Error('vision subagent returned no answer')
              }

              return { content: answer }
            } catch (error) {
              const msg = errText(error)
              if (SESSION_GONE_REGEX.test(msg)) {
                // vision session was deleted — start a fresh one on the next call
                view.sessionID = ''
                views[context.sessionID] = view
                saveViews(views)

                throw new Error('vision session no longer exists; call viewimage again — images must be re-added with `images`', { cause: error })
              }

              if (SESSION_BUSY_REGEX.test(msg)) {
                throw new Error('vision session is busy (another viewimage call in flight) — retry in a moment', { cause: error })
              }

              throw new Error(`vision subagent failed: ${msg.slice(0, 400)}`, { cause: error })
            }
          }
        })
      })
    }
  })
