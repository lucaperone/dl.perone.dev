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

test('formatsForHost enforces per-site format restrictions', () => {
  assert.equal(formatsForHost('instagram.com').includes('png'), true)
  assert.equal(formatsForHost('youtube.com').includes('png'), false)
})

test('rejects a format the host does not offer', async () => {
  const { server } = await import('./server.mjs')
  await new Promise((r) => server.listen(0, r))
  const { port } = server.address()
  const auth = 'Basic ' + Buffer.from('admin:test-secret').toString('base64')
  const res = await fetch('http://127.0.0.1:' + port + '/', {
    method: 'POST',
    headers: { authorization: auth },
    body: new URLSearchParams({ url: 'https://youtube.com/watch?v=x', format: 'png' }),
  })
  assert.equal(res.status, 400)
  await new Promise((r) => server.close(r))
})
