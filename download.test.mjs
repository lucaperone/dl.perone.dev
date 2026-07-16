import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildArgs, needsConvert, zipName } from './download.mjs'

const base = {
  url: 'https://example.com/v',
  outTemplate: '/tmp/dl-x/%(title).150s.%(ext)s',
  nodePath: '/usr/bin/node',
}

test('buildArgs: shared flags and url last', () => {
  const a = buildArgs({ ...base, format: 'mp4' })
  assert.ok(a.includes('--no-playlist'))
  assert.ok(a.includes('--restrict-filenames'))
  const j = a.indexOf('--js-runtimes')
  assert.equal(a[j + 1], 'node:/usr/bin/node')
  const o = a.indexOf('-o')
  assert.equal(a[o + 1], base.outTemplate)
  assert.equal(a.at(-1), base.url)
})

test('buildArgs: mp4 selects merged video', () => {
  const a = buildArgs({ ...base, format: 'mp4' })
  assert.equal(a[a.indexOf('-f') + 1], 'bv*+ba/b')
  assert.equal(a[a.indexOf('--merge-output-format') + 1], 'mp4')
})

test('buildArgs: mp3 extracts audio', () => {
  const a = buildArgs({ ...base, format: 'mp3' })
  assert.ok(a.includes('-x'))
  assert.equal(a[a.indexOf('--audio-format') + 1], 'mp3')
})

test('buildArgs: wav extracts audio', () => {
  const a = buildArgs({ ...base, format: 'wav' })
  assert.ok(a.includes('-x'))
  assert.equal(a[a.indexOf('--audio-format') + 1], 'wav')
})

test('buildArgs: image formats add no video/audio selector', () => {
  for (const format of ['jpg', 'png']) {
    const a = buildArgs({ ...base, format })
    assert.ok(!a.includes('-x'), format)
    assert.ok(!a.includes('--merge-output-format'), format)
    assert.ok(!a.includes('-f'), format)
  }
})

test('needsConvert: only for mismatched image formats', () => {
  assert.equal(needsConvert('.webp', 'jpg'), true)
  assert.equal(needsConvert('.png', 'jpg'), true)
  assert.equal(needsConvert('.jpg', 'jpg'), false)
  assert.equal(needsConvert('.JPEG', 'jpg'), false)
  assert.equal(needsConvert('.png', 'png'), false)
  assert.equal(needsConvert('.jpg', 'mp4'), false)
})

test('zipName: common prefix, trimmed', () => {
  assert.equal(zipName(['My_Post_01.jpg', 'My_Post_02.jpg']), 'My_Post.zip')
  assert.equal(zipName(['1.jpg', '2.jpg']), 'download.zip')
  assert.equal(zipName([]), 'download.zip')
})
