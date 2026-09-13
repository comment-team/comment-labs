import { once } from 'node:events'
import { connect } from 'node:net'
import { scheduler } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { Localdrive } from '../src/index'


const protocolVersion3 = 196_608

const textDecoder = new TextDecoder()
const textEncoder = new TextEncoder()

function readInt32BE(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(offset)
}

function writeInt32BE(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setInt32(offset, value)
}

function concatBytes(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Uint8Array(total)
  let offset = 0

  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }

  return result
}

function cstring(value: string): Uint8Array {
  return concatBytes([ textEncoder.encode(value), Uint8Array.of(0) ])
}

function message(type: number, body: Uint8Array): Uint8Array {
  const length = new Uint8Array(4)
  writeInt32BE(length, 0, body.length + 4)

  return concatBytes([ Uint8Array.of(type), length, body ])
}

function startup(): Uint8Array {
  const version = new Uint8Array(4)
  writeInt32BE(version, 0, protocolVersion3)

  const body = concatBytes([
    cstring('user'), cstring('postgres'),
    cstring('database'), cstring('postgres'),
    Uint8Array.of(0)
  ])
  const length = new Uint8Array(4)
  writeInt32BE(length, 0, body.length + 8)

  return concatBytes([ length, version, body ])
}

function parse(name: string, query: string): Uint8Array {
  return message(0x50, concatBytes([ cstring(name), cstring(query), Uint8Array.of(0, 0) ]))
}

function bind(portal: string, statement: string): Uint8Array {
  return message(0x42, concatBytes([
    cstring(portal), cstring(statement),
    Uint8Array.of(0, 0),
    Uint8Array.of(0, 0),
    Uint8Array.of(0, 0)
  ]))
}

function describePortal(kind: number, name: string): Uint8Array {
  return message(0x44, concatBytes([ Uint8Array.of(kind), cstring(name) ]))
}

function execute(portal: string): Uint8Array {
  return message(0x45, concatBytes([ cstring(portal), Uint8Array.of(0, 0, 0, 0) ]))
}

function sync(): Uint8Array {
  return message(0x53, new Uint8Array(0))
}

function errorMessage(response: Uint8Array): string | undefined {
  let offset = 0

  while (offset + 5 <= response.length) {
    const type = response[offset]
    const length = readInt32BE(response, offset + 1)

    if (type === 0x45) {
      return textDecoder.decode(response.subarray(offset + 5, offset + 1 + length)).split('\0').filter(Boolean).join(' ')
    }

    offset += 1 + length
  }

  return undefined
}

describe('socket server', () => {
  it('assembles a fragmented query before executing it', async () => {
    const controller = new Localdrive({ bindings: { DB: {} } })

    try {
      await controller.initialize()

      const databases = await controller.createTestDatabases()
      const db = databases.DB

      if (db === undefined) {
        throw new Error('Missing DB binding')
      }

      await db.testQuery('CREATE TABLE items (id serial primary key, name text not null)')
      await db.testQuery('INSERT INTO items (name) VALUES ($1)', [ 'a' ])

      const url = new URL(db.connectionString)
      const socket = connect(Number(url.port), url.hostname)

      let received = new Uint8Array(0)
      socket.on('data', data => {
        if (typeof data !== 'string') {
          received = concatBytes([ received, data ])
        }
      })

      await once(socket, 'connect')

      socket.write(startup())

      await scheduler.wait(50)

      socket.write(concatBytes([
        parse('', 'SELECT name FROM items WHERE id = 1'),
        bind('', ''),
        describePortal(0x50, '')
      ]))

      await scheduler.wait(50)

      socket.write(concatBytes([
        execute(''),
        sync()
      ]))

      await scheduler.wait(100)

      const error = errorMessage(received)

      expect(error).toBeUndefined()
      expect(textDecoder.decode(received)).toContain('a')

      socket.destroy()
      await Promise.all(Object.values(databases).map(async database => await database.close()))
    } finally {
      await controller.close()
    }
  })
})
