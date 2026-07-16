import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.AUTH_PASS = 'test-secret'
const { hostAllowed, isValidFormat, formatsForHost } = await import('./server.mjs')

test('spotify is no longer allowed', () => {
  assert.equal(hostAllowed('https://open.spotify.com/track/abc'), false)
})

test('supported hosts still allowed', () => {
  assert.equal(hostAllowed('https://youtu.be/abc'), true)
  assert.equal(hostAllowed('https://www.instagram.com/p/abc/'), true)
  assert.equal(hostAllowed('ftp://youtube.com/x'), false)
})

test('format validation matches the fixed set', () => {
  for (const f of ['mp4', 'mp3', 'wav', 'jpg', 'png']) assert.equal(isValidFormat(f), true)
  assert.equal(isValidFormat('exe'), false)
  assert.equal(isValidFormat(''), false)
})

test('formatsForHost maps hosts to offered formats', () => {
  assert.deepEqual(formatsForHost('youtube.com'), ['mp4', 'mp3', 'wav'])
  assert.deepEqual(formatsForHost('youtu.be'), ['mp4', 'mp3', 'wav'])
  assert.deepEqual(formatsForHost('www.instagram.com'), ['mp4', 'mp3', 'wav', 'jpg', 'png'])
  assert.deepEqual(formatsForHost('x.com'), ['mp4', 'mp3', 'wav', 'jpg', 'png'])
  assert.equal(formatsForHost('unknown.com'), null)
})
