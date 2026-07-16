import { crc32 } from 'node:zlib'

const LFH_SIG = 0x04034b50
const CDH_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
const DOS_TIME = 0x0000
const DOS_DATE = 0x0021 // 1980-01-01, a fixed valid DOS date

export function zipBuffers(entries) {
  const chunks = []
  const central = []
  let offset = 0

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(data) >>> 0
    const size = data.length

    const lfh = Buffer.alloc(30)
    lfh.writeUInt32LE(LFH_SIG, 0)
    lfh.writeUInt16LE(20, 4)
    lfh.writeUInt16LE(0x0800, 6) // UTF-8 filename flag
    lfh.writeUInt16LE(0, 8) // store
    lfh.writeUInt16LE(DOS_TIME, 10)
    lfh.writeUInt16LE(DOS_DATE, 12)
    lfh.writeUInt32LE(crc, 14)
    lfh.writeUInt32LE(size, 18)
    lfh.writeUInt32LE(size, 22)
    lfh.writeUInt16LE(nameBuf.length, 26)
    lfh.writeUInt16LE(0, 28)
    chunks.push(lfh, nameBuf, data)

    const cdh = Buffer.alloc(46)
    cdh.writeUInt32LE(CDH_SIG, 0)
    cdh.writeUInt16LE(20, 4)
    cdh.writeUInt16LE(20, 6)
    cdh.writeUInt16LE(0x0800, 8)
    cdh.writeUInt16LE(0, 10)
    cdh.writeUInt16LE(DOS_TIME, 12)
    cdh.writeUInt16LE(DOS_DATE, 14)
    cdh.writeUInt32LE(crc, 16)
    cdh.writeUInt32LE(size, 20)
    cdh.writeUInt32LE(size, 24)
    cdh.writeUInt16LE(nameBuf.length, 28)
    cdh.writeUInt16LE(0, 30)
    cdh.writeUInt16LE(0, 32)
    cdh.writeUInt16LE(0, 34)
    cdh.writeUInt16LE(0, 36)
    cdh.writeUInt32LE(0, 38)
    cdh.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([cdh, nameBuf]))

    offset += lfh.length + nameBuf.length + size
  }

  const cd = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(EOCD_SIG, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...chunks, cd, eocd])
}
