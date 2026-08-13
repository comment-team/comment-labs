import { describe, expect, it, vi } from 'vitest'
import { startControlServer } from '../src/control-server'


describe('control server', () => {
  it('resets registered databases', async () => {
    const server = await startControlServer()
    const database = { reset: vi.fn<() => Promise<void>>() }

    try {
      server.register(database)

      const response = await fetch(server.url, { method: 'POST' })

      expect(response.status).toBe(204)
      expect(database.reset).toHaveBeenCalledOnce()
    } finally {
      await server.stop()
    }
  })

  it('returns 404 for non-reset requests', async () => {
    const server = await startControlServer()

    try {
      const response = await fetch(server.url.replace('/reset', '/'), { method: 'POST' })

      expect(response.status).toBe(404)
    } finally {
      await server.stop()
    }
  })

  it('returns 500 when a reset throws', async () => {
    const server = await startControlServer()
    const database = { reset: vi.fn<() => Promise<void>>().mockRejectedValue(new Error('reset failed')) }

    try {
      server.register(database)

      const response = await fetch(server.url, { method: 'POST' })

      expect(response.status).toBe(500)
    } finally {
      await server.stop()
    }
  })
})
