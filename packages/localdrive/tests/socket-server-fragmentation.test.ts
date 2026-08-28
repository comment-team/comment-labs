import { once } from 'node:events'
import { connect } from 'node:net'
import { describe, expect, it } from 'vitest'
import { Localdrive } from '../src/index'


const protocolVersion3 = 196608

const textDecoder = new TextDecoder()

function readInt32BE(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(offset)
}

function cstring(value: string): Buffer {
  return Buffer.concat([ Buffer.from(value), Buffer.from([ 0 ]) ])
}

function message(type: number, body: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeInt32BE(body.length + 4)

  return Buffer.concat([ Buffer.from([ type ]), length, body ])
}

function startup(): Buffer {
  const version = Buffer.alloc(4)
  version.writeInt32BE(protocolVersion3)
  const body = Buffer.concat([
    cstring('user'), cstring('postgres'),
    cstring('database'), cstring('postgres'),
    Buffer.from([ 0 ])
  ])
  const length = Buffer.alloc(4)
  length.writeInt32BE(body.length + 8)

  return Buffer.concat([ length, version, body ])
}

function parse(name: string, query: string): Buffer {
  return message(0x50, Buffer.concat([ cstring(name), cstring(query), Buffer.from([ 0, 0 ]) ]))
}

function bind(portal: string, statement: string): Buffer {
  return message(0x42, Buffer.concat([
    cstring(portal), cstring(statement),
    Buffer.from([ 0, 0 ]),
    Buffer.from([ 0, 0 ]),
    Buffer.from([ 0, 0 ])
  ]))
}

function describePortal(kind: number, name: string): Buffer {
  return message(0x44, Buffer.concat([ Buffer.from([ kind ]), cstring(name) ]))
}

function execute(portal: string): Buffer {
  return message(0x45, Buffer.concat([ cstring(portal), Buffer.from([ 0, 0, 0, 0 ]) ]))
}

function sync(): Buffer {
  return message(0x53, Buffer.alloc(0))
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

      let received = Buffer.alloc(0)
      socket.on('data', data => {
        received = Buffer.concat([ received, data ])
      })

      await once(socket, 'connect')

      socket.write(startup())

      await new Promise(resolve => setTimeout(resolve, 50))

      socket.write(Buffer.concat([
        parse('', 'SELECT name FROM items WHERE id = 1'),
        bind('', ''),
        describePortal(0x50, '')
      ]))

      await new Promise(resolve => setTimeout(resolve, 50))

      socket.write(Buffer.concat([
        execute(''),
        sync()
      ]))

      await new Promise(resolve => setTimeout(resolve, 100))

      const error = errorMessage(received)

      expect(error).toBeUndefined()
      expect(received.toString('utf8')).toContain('a')

      socket.destroy()
      await Promise.all(Object.values(databases).map(async database => await database.close()))
    } finally {
      await controller.close()
    }
  })
})