/**
 * loop-guard core: detects repeated identical tool calls (same tool + same
 * arguments) back to back within a session and breaks the loop.
 * Framework-agnostic — the V2 adapter runs this core.
 */

export type LoopGuardOptions = {
  /** identical consecutive calls allowed before blocking (default 4) */
  threshold?: number
  disabled?: boolean
}

type RingEntry = { hash: string; tool: string; count: number }

const MAX_SESSIONS = 500

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

export class LoopTracker {
  private readonly rings = new Map<string, RingEntry>()
  private readonly threshold: number

  constructor(opts: LoopGuardOptions = {}) {
    this.threshold = Math.max(2, opts.threshold ?? 4)
  }

  /**
   * Deterministic key for the call's arguments (sorted-key stringify).
   */
  static hashArgs(args: unknown): string {
    const stable = (v: unknown): unknown => {
      if (Array.isArray(v)) {
        return v.map(item => stable(item))
      }

      if (isPlainObject(v)) {
        const sorted = Object.entries(v).toSorted(([ a ], [ b ]) => {
          if (a < b) {
            return -1
          }

          if (a > b) {
            return 1
          }

          return 0
        })

        return Object.fromEntries(sorted.map(([ k, val ]) => [ k, stable(val) ]))
      }

      return v
    }

    return JSON.stringify(stable(args))
  }

  /**
   * Record a call and return a block message when it is the
   * Nth identical consecutive call (N = threshold).
   */
  observe(sessionID: string, tool: string, args: unknown): string | undefined {
    const hash = LoopTracker.hashArgs(args)
    const ring = this.rings.get(sessionID)
    if (ring === undefined || ring.hash !== hash) {
      this.rings.set(sessionID, { hash, tool, count: 1 })

      if (this.rings.size > MAX_SESSIONS) {
        // drop the oldest half — bounded memory, sessions are long-lived keys
        let dropped = 0
        const half = Math.floor(MAX_SESSIONS / 2)

        for (const k of this.rings.keys()) {
          this.rings.delete(k)
          dropped++

          if (dropped >= half) {
            break
          }
        }
      }

      return undefined
    }

    ring.count += 1
    if (ring.count < this.threshold) {
      return undefined
    }

    // reset the counter after blocking so a corrected retry gets through
    ring.count = 0

    return (
      `loop-guard BLOCKED: \`${tool}\` has now been called with IDENTICAL arguments `
      + `${this.threshold} times in a row. You are stuck in a loop. Change your approach: `
      + 'vary the inputs, try a different tool, or stop and tell the user what you need. '
      + 'If repeating is genuinely required, wait or change even one argument.'
    )
  }
}
