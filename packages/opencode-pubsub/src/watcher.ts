import { watch, type FSWatcher } from 'node:fs'
import { mkdir } from 'node:fs/promises'

const DEBOUNCE_MS = 150
const RETRY_MS = 1000

export async function watchBus(busDir: string, onChange: () => void): Promise<() => void> {
  await mkdir(busDir, { recursive: true })

  let watcher: FSWatcher | undefined
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const schedule = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = undefined
      onChange()
    }, DEBOUNCE_MS)
  }

  function restart() {
    watcher?.close()
    watcher = undefined
    if (stopped) {
      return
    }

    retryTimer = setTimeout(() => {
      retryTimer = undefined
      start()
    }, RETRY_MS)
  }

  function start() {
    if (stopped) {
      return
    }

    try {
      watcher = watch(busDir, { recursive: true }, schedule)
      watcher.on('error', restart)
    } catch {
      restart()
    }
  }

  start()

  return () => {
    stopped = true
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }

    if (retryTimer) {
      clearTimeout(retryTimer)
    }

    watcher?.close()
  }
}
