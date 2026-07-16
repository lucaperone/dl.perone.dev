import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { basename } from 'node:path'
import { download } from './download.mjs'

const PORT = Number(process.env.PORT || 8080)
const USER = process.env.AUTH_USER || 'admin'
const PASS = process.env.AUTH_PASS
if (!PASS) {
  console.error('AUTH_PASS env var is required')
  process.exit(1)
}

const ALLOWED_HOSTS = [
  'youtube.com',
  'youtu.be',
  'instagram.com',
  'tiktok.com',
  'x.com',
  'twitter.com',
  'open.spotify.com',
]

const PAGE = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>dl</title>
<style>
 body{font:16px system-ui,sans-serif;max-width:34rem;margin:4rem auto;padding:0 1rem}
 form{display:flex;gap:.5rem}
 input{flex:1;padding:.6rem;font-size:1rem}
 button{padding:.6rem 1rem;font-size:1rem;cursor:pointer}
 p{color:#666}
</style></head>
<body>
<h1>dl</h1>
<form method="post" action="/">
 <input name="url" type="url" placeholder="Paste a supported URL" required autofocus>
 <button>Download</button>
</form>
<p>YouTube · Instagram · TikTok · X · Spotify</p>
</body></html>`

const server = createServer((req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')

  if (req.url === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    return res.end('User-agent: *\nDisallow: /\n')
  }

  if (!authed(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="dl"' })
    return res.end('Auth required\n')
  }

  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end(PAGE)
  }

  if (req.method === 'POST' && req.url === '/') {
    let body = ''
    req.on('data', (c) => {
      body += c
      if (body.length > 4096) req.destroy() // it's a URL, not a payload
    })
    req.on('end', () => handleDownload(res, body))
    return
  }

  res.writeHead(404).end()
})

server.listen(PORT, () => console.log(`dl listening on :${PORT}`))

async function handleDownload(res, body) {
  const url = new URLSearchParams(body).get('url') || ''
  if (!hostAllowed(url)) {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    return res.end('Unsupported or invalid URL\n')
  }

  let job
  try {
    job = await download(url)
  } catch (err) {
    console.error(err.message)
    res.writeHead(502, { 'Content-Type': 'text/plain' })
    return res.end('Download failed\n')
  }

  const name = basename(job.file).replace(/"/g, '')
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${name}"`,
  })
  const stream = createReadStream(job.file)
  stream.pipe(res)
  const cleanup = () => rm(job.dir, { recursive: true, force: true }).catch(() => {})
  stream.on('close', cleanup)
  res.on('close', cleanup)
}

function authed(req) {
  const h = req.headers.authorization || ''
  if (!h.startsWith('Basic ')) return false
  const [u, p] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':')
  return safeEq(u, USER) && safeEq(p ?? '', PASS)
}

function safeEq(a, b) {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

function hostAllowed(raw) {
  let u
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  const host = u.hostname.replace(/^www\./, '')
  return ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h))
}
