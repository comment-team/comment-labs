import { once } from 'node:events'
import { createServer, type Server, type Socket } from 'node:net'
import type { PGliteInterface } from '@electric-sql/pglite'


const sslRequestCode = 80877103
const cancelRequestCode = 80877102
const protocolVersion3 = 196608

const parseMessage = 0x50
const bindMessage = 0x42
const describeMessage = 0x44
const closeMessage = 0x43
const executeMessage = 0x45
const statementKind = 0x53
const portalKind = 0x50

const syncMessage = 0x53
const queryMessage = 0x51
const terminateMessage = 0x58
const flushMessage = 0x48

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

interface ConnectionState {
  readonly id: number
  buffer: Uint8Array
  statementCounter: number
  portalCounter: number
  currentStatement: string | undefined
  currentPortal: string | undefined
}

interface Batch {
  readonly connectionId: number
  readonly messages: Uint8Array
  readonly onData: (data: Uint8Array) => void
  readonly onError: (error: Error) => void
}

export interface LocaldriveSocketServerOptions {
  db: PGliteInterface
  host?: string
  port?: number
  maxConnections?: number
}

export class LocaldriveSocketServer {
  private readonly db: PGliteInterface
  private readonly host: string
  private readonly maxConnections: number
  private readonly connections = new Map<Socket, ConnectionState>()
  private readonly queue: Batch[] = []
  private port: number
  private server: Server | undefined
  private connectionCounter = 0
  private lastConnectionId: number | undefined
  private drain: Promise<void> | undefined
  private stopped = false

  constructor(options: LocaldriveSocketServerOptions) {
    this.db = options.db
    this.host = options.host ?? '127.0.0.1'
    this.port = options.port ?? 0
    this.maxConnections = options.maxConnections ?? 16
  }

  async start(): Promise<void> {
    await this.db.waitReady

    this.server = createServer(socket => this.handleConnection(socket))
    this.server.maxConnections = this.maxConnections
    this.server.listen(this.port, this.host)
    await once(this.server, 'listening')

    const address = this.server.address()

    if (address !== null && typeof address === 'object') {
      this.port = address.port
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return
    }

    this.stopped = true
    this.queue.length = 0

    // Let the in-flight batch finish and deliver its response before any
    // connection is closed, so clients never lose a query result mid-flight.
    await this.drain

    for (const socket of this.connections.keys()) {
      socket.end()
    }

    const server = this.server
    this.server = undefined

    if (server !== undefined) {
      // Clients normally close their side promptly after the FIN above; the
      // timer force-closes any that linger so the port is always released.
      const fallback = setTimeout(() => {
        for (const socket of this.connections.keys()) {
          socket.destroy()
        }
      }, 1000)

      server.close()
      await once(server, 'close')
      clearTimeout(fallback)
    }

    this.connections.clear()
  }

  getServerConn(): string {
    return `${this.host}:${this.port}`
  }

  private handleConnection(socket: Socket): void {
    if (this.stopped || this.connections.size >= this.maxConnections) {
      socket.end()

      return
    }

    const state: ConnectionState = {
      id: ++this.connectionCounter,
      buffer: new Uint8Array(0),
      statementCounter: 0,
      portalCounter: 0,
      currentStatement: undefined,
      currentPortal: undefined
    }

    this.connections.set(socket, state)
    socket.setNoDelay(true)
    socket.on('data', data => {
      if (typeof data !== 'string') {
        this.handleData(socket, state, data)
      }
    })
    socket.on('error', () => {})
    socket.on('close', () => {
      this.connections.delete(socket)
    })
  }

  private handleData(socket: Socket, state: ConnectionState, data: Uint8Array): void {
    state.buffer = concatBytes(state.buffer, data)
    this.drainConnection(socket, state)
  }

  private drainConnection(socket: Socket, state: ConnectionState): void {
    let buffer = state.buffer

    while (true) {
      if (buffer.length >= 8 && readInt32BE(buffer, 0) === 8 && readInt32BE(buffer, 4) === sslRequestCode) {
        socket.write('N')
        buffer = buffer.subarray(8)
        continue
      }

      if (buffer.length >= 16 && readInt32BE(buffer, 0) === 16 && readInt32BE(buffer, 4) === cancelRequestCode) {
        buffer = buffer.subarray(16)
        continue
      }

      break
    }

    const messages: Uint8Array[] = []
    let offset = 0
    let cycleEnd = 0
    let flushCount = 0

    while (offset < buffer.length) {
      const remaining = buffer.length - offset

      if (remaining < 4) {
        break
      }

      let messageLength = 0
      let isStartup = false

      if (remaining >= 8 && readInt32BE(buffer, offset + 4) === protocolVersion3) {
        messageLength = readInt32BE(buffer, offset)
        isStartup = true
      }

      if (messageLength === 0 && remaining >= 5) {
        messageLength = 1 + readInt32BE(buffer, offset + 1)
      }

      if (messageLength === 0 || remaining < messageLength) {
        break
      }

      messages.push(buffer.subarray(offset, offset + messageLength))
      offset += messageLength

      if (isStartup || isFlushBoundary(buffer[offset - messageLength] ?? 0)) {
        cycleEnd = offset
        flushCount = messages.length
      }
    }

    state.buffer = buffer.subarray(cycleEnd)

    if (flushCount === 0) {
      return
    }

    const remapped = messages.slice(0, flushCount).map(message => remapMessage(message, state))

    this.enqueue({
      connectionId: state.id,
      messages: concatAll(remapped),
      onData: data => {
        if (!socket.destroyed && socket.writable) {
          socket.write(data)
        }
      },
      onError: () => {
        socket.destroy()
      }
    })
  }

  private enqueue(batch: Batch): void {
    if (this.stopped) {
      return
    }

    this.queue.push(batch)

    if (this.drain === undefined) {
      this.drain = this.drainQueue().finally(() => {
        this.drain = undefined
      })
    }
  }

  private async drainQueue(): Promise<void> {
    while (!this.stopped) {
      const batch = this.pickBatch()

      if (batch === undefined) {
        return
      }

      await this.execute(batch)
    }
  }

  private pickBatch(): Batch | undefined {
    if (this.db.isInTransaction() && this.lastConnectionId !== undefined) {
      const index = this.queue.findIndex(batch => batch.connectionId === this.lastConnectionId)

      if (index === -1) {
        return undefined
      }

      return this.queue.splice(index, 1)[0]
    }

    return this.queue.shift()
  }

  private async execute(batch: Batch): Promise<void> {
    try {
      await this.db.runExclusive(async () => {
        await this.db.execProtocolRawStream(batch.messages, {
          onRawData: batch.onData
        })
      })

      this.lastConnectionId = batch.connectionId
    } catch (error) {
      batch.onError(error as Error)
    }
  }
}

function remapMessage(message: Uint8Array, state: ConnectionState): Uint8Array {
  switch (message[0]) {
    case parseMessage:
      return remapParse(message, state)
    case bindMessage:
      return remapBind(message, state)
    case describeMessage:
    case closeMessage:
      return remapDescribeOrClose(message, state)
    case executeMessage:
      return remapExecute(message, state)
    default:
      return message
  }
}

function isFlushBoundary(type: number): boolean {
  return type === syncMessage || type === queryMessage || type === terminateMessage || type === flushMessage
}

function remapParse(message: Uint8Array, state: ConnectionState): Uint8Array {
  const [ name ] = readCString(message, 5)
  const unnamed = name === ''
  const replacement = unnamed
    ? `_ld_${state.id}_u${++state.statementCounter}`
    : `_ld_${state.id}_s_${name}`

  if (unnamed) {
    state.currentStatement = replacement
  }

  return replaceCString(message, 5, replacement).result
}

function remapBind(message: Uint8Array, state: ConnectionState): Uint8Array {
  const [ portal, statementOffset ] = readCString(message, 5)
  const [ statement ] = readCString(message, statementOffset)
  const replacementPortal = portal === ''
    ? `_ld_${state.id}_v${++state.portalCounter}`
    : `_ld_${state.id}_p_${portal}`
  const replacementStatement = statement === ''
    ? (state.currentStatement ?? '')
    : `_ld_${state.id}_s_${statement}`

  if (portal === '') {
    state.currentPortal = replacementPortal
  }

  const withPortal = replaceCString(message, 5, replacementPortal)

  return replaceCString(withPortal.result, statementOffset + withPortal.delta, replacementStatement).result
}

function remapDescribeOrClose(message: Uint8Array, state: ConnectionState): Uint8Array {
  const kind = message[5]
  const [ name ] = readCString(message, 6)
  const replacement = name === ''
    ? (kind === statementKind ? state.currentStatement : state.currentPortal)
    : `_ld_${state.id}_${kind === statementKind ? 's' : 'p'}_${name}`

  return replaceCString(message, 6, replacement ?? '').result
}

function remapExecute(message: Uint8Array, state: ConnectionState): Uint8Array {
  const [ portal ] = readCString(message, 5)
  const replacement = portal === ''
    ? (state.currentPortal ?? '')
    : `_ld_${state.id}_p_${portal}`

  return replaceCString(message, 5, replacement).result
}

function readCString(bytes: Uint8Array, offset: number): [string, number] {
  let end = offset

  while (end < bytes.length && bytes[end] !== 0) {
    end++
  }

  return [ textDecoder.decode(bytes.subarray(offset, end)), end + 1 ]
}

function replaceCString(message: Uint8Array, offset: number, replacement: string): { result: Uint8Array, delta: number } {
  let end = offset

  while (end < message.length && message[end] !== 0) {
    end++
  }

  const valueByteLength = end - offset + 1
  const replacementBytes = textEncoder.encode(replacement)
  const replacementByteLength = replacementBytes.length + 1
  const delta = replacementByteLength - valueByteLength
  const result = new Uint8Array(message.length + delta)

  result.set(message.subarray(0, offset))
  result.set(replacementBytes, offset)
  result[offset + replacementBytes.length] = 0
  result.set(message.subarray(end + 1), offset + replacementByteLength)
  writeInt32BE(result, 1, readInt32BE(message, 1) + delta)

  return { result, delta }
}

function readInt32BE(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(offset)
}

function writeInt32BE(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setInt32(offset, value)
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.length + right.length)

  result.set(left)
  result.set(right, left.length)

  return result
}

function concatAll(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, array) => sum + array.length, 0)
  const result = new Uint8Array(total)
  let offset = 0

  for (const array of arrays) {
    result.set(array, offset)
    offset += array.length
  }

  return result
}