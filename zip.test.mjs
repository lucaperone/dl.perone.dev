import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crc32 } from 'node:zlib'
import { zipBuffers } from './zip.mjs'

test('zipBuffers builds a valid store-method archive', () => {
  const entries = [
    { name: 'a.txt', data: Buffer.from('hello world') },
    { name: 'b.bin', data: Buffer.from([1, 2, 3, 4, 5, 0, 255]) },
  ]
  const zip = zipBuffers(entries)

  const eocd = zip.subarray(zip.length - 22)
  assert.equal(eocd.readUInt32LE(0), 0x06054b50, 'EOCD signature')
  assert.equal(eocd.readUInt16LE(10), 2, 'total CD records')
  const cdSize = eocd.readUInt32LE(12)
  const cdOffset = eocd.readUInt32LE(16)

  let p = cdOffset
  for (const expected of entries) {
    assert.equal(zip.readUInt32LE(p), 0x02014b50, 'CD header signature')
    const crc = zip.readUInt32LE(p + 16)
    const size = zip.readUInt32LE(p + 24)
    const nameLen = zip.readUInt16LE(p + 28)
    const lho = zip.readUInt32LE(p + 42)
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8')

    assert.equal(name, expected.name)
    assert.equal(crc, crc32(expected.data) >>> 0, 'stored CRC matches')

    assert.equal(zip.readUInt32LE(lho), 0x04034b50, 'local header signature')
    const lhNameLen = zip.readUInt16LE(lho + 26)
    const dataStart = lho + 30 + lhNameLen
    const data = zip.subarray(dataStart, dataStart + size)
    assert.deepEqual(Buffer.from(data), expected.data, 'stored bytes match')

    p += 46 + nameLen
  }
  assert.equal(p - cdOffset, cdSize, 'central directory size')
})

test('zipBuffers handles a single entry', () => {
  const zip = zipBuffers([{ name: 'only.jpg', data: Buffer.from('x') }])
  assert.equal(zip.subarray(zip.length - 22).readUInt16LE(10), 1)
})
