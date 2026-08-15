import zlib from 'node:zlib'

/**
 * Build a real zip in memory: local headers + central directory + EOCD, with a
 * mix of stored and deflated entries, so the reader is exercised against the
 * genuine format rather than a mock. Directory entries get a trailing slash.
 */
export function makeZip(files: Record<string, string | Buffer>, opts: { deflate?: boolean } = {}): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  const crcTable = buildCrcTable()

  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8')
    const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
    const isDir = name.endsWith('/')
    const deflate = opts.deflate !== false && !isDir && data.length > 0
    const stored = deflate ? zlib.deflateRawSync(data) : data
    const method = deflate ? 8 : 0
    const crc = crc32(data, crcTable)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x800, 6) // flags: utf8 names
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(stored.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)

    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(0x800, 8)
    header.writeUInt16LE(method, 10)
    header.writeUInt32LE(crc, 16)
    header.writeUInt32LE(stored.length, 20)
    header.writeUInt32LE(data.length, 24)
    header.writeUInt16LE(nameBuf.length, 28)
    header.writeUInt16LE(0, 30)
    header.writeUInt16LE(0, 32)
    header.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([header, nameBuf]))

    parts.push(local, nameBuf, stored)
    offset += local.length + nameBuf.length + stored.length
  }

  const cd = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(central.length, 8)
  eocd.writeUInt16LE(central.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cd, eocd])
}

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
}

function crc32(buf: Buffer, table: Uint32Array): number {
  let crc = 0xffffffff
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
