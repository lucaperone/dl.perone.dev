# UI, Format Picker, Progress & Carousel-ZIP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-download format choice (MP4/MP3/WAV/JPG/PNG), a fetch-based spinner, a faster responsive UI with URL-driven format chips, and ZIP packaging for multi-file posts (IG carousels) — all zero-dep.

**Architecture:** `download.mjs` gains a pure `buildArgs` mapping and a single-vs-ZIP finalize step; a new pure `zip.mjs` builds store-method archives with Node's built-in `zlib.crc32`. `server.mjs` validates the `format` field, exposes a host→formats map to the page, and serves a fetch-driven single-page UI. Startup is guarded so pure helpers are importable in `node:test`.

**Tech Stack:** Node 24 ESM (`.mjs`), stdlib only (`node:http`, `node:child_process`, `node:zlib`, `node:crypto`, `node:fs/promises`, `node:path`, `node:os`, `node:url`), `node:test` for tests. `yt-dlp` + `ffmpeg` binaries (vendored). No frontend framework/build.

## Global Constraints

- **Node ≥24, ESM, `.mjs` only.** No TypeScript, no bundler, no transpile.
- **Zero runtime dependencies.** Stdlib only; tests use built-in `node:test`. Add no packages.
- **Frontend:** one HTML page, one inline `<style>`, inline `<script>`. No framework, no build step, no third-party/network requests from the page.
- **Preserve:** `X-Robots-Tag: noindex, nofollow` on every response, `robots.txt` disallow-all, `<meta name="robots" content="noindex, nofollow">`, HTTP Basic auth gating all routes except `robots.txt`.
- **Formats (exact set):** `mp4` (default), `mp3`, `wav`, `jpg`, `png`.
- **Host→formats map (exact):** youtube.com/youtu.be → `["mp4","mp3","wav"]`; tiktok.com → `["mp4","mp3","wav"]`; instagram.com → `["mp4","mp3","wav","jpg","png"]`; x.com/twitter.com → `["mp4","mp3","wav","jpg","png"]`.
- **Spotify removed** from the allowlist and UI copy.
- **Style:** no comments except a non-obvious *why*; no dead code / compat shims; validate only at the edge (URL, auth, format). Match existing file style (2-space indent, single quotes, no semicolons — mirror current `.mjs`).
- **Commits:** short imperative subject (`feat:`/`fix:`/`docs:`), no AI signature lines.

---

### Task 1: `zip.mjs` — store-method ZIP writer

**Files:**
- Create: `zip.mjs`
- Test: `zip.test.mjs`
- Modify: `package.json` (add `test` script)

**Interfaces:**
- Consumes: `node:zlib` `crc32`.
- Produces: `zipBuffers(entries: Array<{name: string, data: Buffer}>): Buffer` — a valid store-method (uncompressed) ZIP containing the entries in order.

- [ ] **Step 1: Add the test script to `package.json`**

Add to the `scripts` block (keep existing `setup`/`start`):

```json
  "scripts": {
    "setup": "bash bin/setup.sh",
    "start": "node --env-file-if-exists=.env server.mjs",
    "test": "node --test"
  }
```

- [ ] **Step 2: Write the failing test**

Create `zip.test.mjs`:

```js
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `./zip.mjs` (or `zipBuffers` not exported).

- [ ] **Step 4: Implement `zip.mjs`**

Create `zip.mjs`:

```js
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS (both `zip.test.mjs` tests).

- [ ] **Step 6: Manual real-unzipper check**

Run:
```bash
node -e "import('./zip.mjs').then(async ({zipBuffers})=>{const {writeFile}=await import('node:fs/promises');await writeFile('/tmp/t.zip',zipBuffers([{name:'a.txt',data:Buffer.from('hi')},{name:'b.txt',data:Buffer.from('yo')}]))})"
unzip -l /tmp/t.zip && unzip -o /tmp/t.zip -d /tmp/tz && cat /tmp/tz/a.txt /tmp/tz/b.txt
```
Expected: `unzip` lists 2 files and extracts `hi`/`yo`. (If `unzip` is absent, skip — the node:test parse-check already validates the format.)

- [ ] **Step 7: Commit**

```bash
git add zip.mjs zip.test.mjs package.json
git commit -m "feat: add zero-dep store-method zip writer"
```

---

### Task 2: `download.mjs` — pure helpers (args, convert-check, zip name)

**Files:**
- Modify: `download.mjs` (add exported pure functions; leave existing `download`/`run` in place for now)
- Test: `download.test.mjs`

**Interfaces:**
- Produces:
  - `buildArgs({ format, url, outTemplate, nodePath }): string[]` — yt-dlp argv (shared flags + per-format flags, `url` last).
  - `needsConvert(srcExt: string, format: string): boolean` — true only for `jpg`/`png` when `srcExt` isn't already that format.
  - `zipName(names: string[]): string` — archive filename from a list of member filenames.

- [ ] **Step 1: Write the failing test**

Create `download.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `buildArgs`/`needsConvert`/`zipName` not exported from `download.mjs`.

- [ ] **Step 3: Implement the pure helpers**

In `download.mjs`, add `extname` to the `node:path` import so it reads:

```js
import { basename, dirname, extname, join } from 'node:path'
```

Then add these exported functions (place them above the existing `download` function):

```js
const SHARED = ['--no-playlist', '--no-progress', '--restrict-filenames']

const FORMAT_FLAGS = {
  mp4: ['-f', 'bv*+ba/b', '-S', 'ext:mp4:m4a', '--merge-output-format', 'mp4'],
  mp3: ['-x', '--audio-format', 'mp3', '--audio-quality', '0'],
  wav: ['-x', '--audio-format', 'wav'],
  jpg: [],
  png: [],
}

export function buildArgs({ format, url, outTemplate, nodePath }) {
  return [
    ...SHARED,
    '--js-runtimes', `node:${nodePath}`,
    ...FORMAT_FLAGS[format],
    '-o', outTemplate,
    url,
  ]
}

export function needsConvert(srcExt, format) {
  if (format !== 'jpg' && format !== 'png') return false
  const ext = srcExt.toLowerCase().replace(/^\./, '')
  const ok = format === 'jpg' ? ['jpg', 'jpeg'] : ['png']
  return !ok.includes(ext)
}

export function zipName(names) {
  const bases = names.map((n) => n.replace(/\.[^.]+$/, ''))
  let prefix = bases[0] ?? ''
  for (const b of bases.slice(1)) {
    let i = 0
    while (i < prefix.length && i < b.length && prefix[i] === b[i]) i++
    prefix = prefix.slice(0, i)
  }
  prefix = prefix.replace(/[-_.\s0-9]+$/, '')
  return `${prefix || 'download'}.zip`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all `download.test.mjs` cases + Task 1 tests).

- [ ] **Step 5: Commit**

```bash
git add download.mjs download.test.mjs
git commit -m "feat: pure yt-dlp arg builder, image-convert check, zip naming"
```

---

### Task 3: `download.mjs` — orchestration (format branch, image convert, single-vs-zip)

**Files:**
- Modify: `download.mjs:12-47` (binary resolution + rewrite `download`; add `convertImages`)
- Manual verification (spawns yt-dlp/ffmpeg — not unit tested)

**Interfaces:**
- Consumes: `buildArgs`, `needsConvert`, `zipName` (Task 2); `zipBuffers` (Task 1).
- Produces: `download(url: string, format = 'mp4'): Promise<{ dir: string, file: string }>` — unchanged shape; `file` is a single media file, or a `.zip` when yt-dlp yields >1 file.

- [ ] **Step 1: Add imports and ffmpeg resolution**

Update the top-of-file imports so `readFile`/`writeFile` are available:

```js
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipBuffers } from './zip.mjs'
```

Below the existing `YTDLP` constant, add an `FFMPEG` constant (mirrors the yt-dlp resolution — vendored dir, else PATH):

```js
const FFMPEG =
  process.env.FFMPEG_PATH ||
  (existsSync(join(vendor, 'ffmpeg')) ? join(vendor, 'ffmpeg') : 'ffmpeg')
```

- [ ] **Step 2: Rewrite `download` and add `convertImages`**

Replace the existing `download` function body with:

```js
export async function download(url, format = 'mp4') {
  const dir = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'dl-'))
  try {
    await run(YTDLP, buildArgs({
      format,
      url,
      nodePath: process.execPath,
      outTemplate: join(dir, '%(title).150s.%(ext)s'),
    }))

    let files = await readdir(dir)
    if (files.length === 0) throw new Error('yt-dlp produced no file')

    if (format === 'jpg' || format === 'png') {
      files = await convertImages(dir, files, format)
    }

    if (files.length === 1) return { dir, file: join(dir, files[0]) }

    const entries = await Promise.all(
      files.map(async (name) => ({ name, data: await readFile(join(dir, name)) })),
    )
    const zipPath = join(dir, zipName(files))
    await writeFile(zipPath, zipBuffers(entries))
    return { dir, file: zipPath }
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    throw err
  }
}

async function convertImages(dir, files, format) {
  const out = []
  for (const name of files) {
    const ext = extname(name)
    if (!needsConvert(ext, format)) {
      out.push(name)
      continue
    }
    const dst = `${basename(name, ext)}.${format}`
    await run(FFMPEG, ['-y', '-i', join(dir, name), join(dir, dst)])
    await rm(join(dir, name)).catch(() => {})
    out.push(dst)
  }
  return out
}
```

> Note: `buildArgs`, `needsConvert`, `zipName` must be referenced from the same module (they are — defined in Task 2). Keep `dirname` in the import even though only `basename`/`extname`/`join` are used by new code — the existing `root` computation uses `dirname`.

- [ ] **Step 3: Verify unit tests still pass (no regression)**

Run: `npm test`
Expected: PASS — Task 2's pure-helper tests are unaffected by the orchestration rewrite.

- [ ] **Step 4: Manual end-to-end (requires vendored binaries)**

Prereq: `npm run setup` has populated `./vendor`, and `.env` has `AUTH_PASS`.

Run (video + audio + image, single file each):
```bash
node -e "process.env.AUTH_PASS='x';import('./download.mjs').then(async({download})=>{for(const f of ['mp4','mp3']){const j=await download('https://www.youtube.com/watch?v=dQw4w9WgXcQ',f);console.log(f,'->',j.file);await (await import('node:fs/promises')).rm(j.dir,{recursive:true,force:true})}})"
```
Expected: prints an `.mp4` path then an `.mp3` path. (Replace the URL if it fails to resolve.)

Carousel → zip: run the same against a known multi-image Instagram post URL with `format:'jpg'`; expected `file` ends in `.zip`. If no test URL is handy, note it for the final manual checklist in Task 6.

- [ ] **Step 5: Commit**

```bash
git add download.mjs
git commit -m "feat: format-aware download with image convert and carousel zip"
```

---

### Task 4: `server.mjs` — backend (testable startup, format validation, host map, spotify removal)

**Files:**
- Modify: `server.mjs` (imports, guard startup, exports, `FORMATS`/`isValidFormat`, `HOST_FORMATS`/`formatsForHost`, remove spotify, pass `format` to `download`)
- Test: `server.test.mjs`

**Interfaces:**
- Produces (exported for tests + page): `hostAllowed(raw: string): boolean`, `isValidFormat(f: string): boolean`, `formatsForHost(host: string): string[] | null`, `HOST_FORMATS: object`, `FORMATS: string[]`.
- Consumes: `download(url, format)` (Task 3).

- [ ] **Step 1: Write the failing test**

Create `server.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — exports missing / server tries to start on import (that's what the guard in Step 4 fixes).

- [ ] **Step 3: Add the `node:url` import**

At the top of `server.mjs`, add:

```js
import { pathToFileURL } from 'node:url'
```

- [ ] **Step 4: Guard startup so the module is importable**

The current top-level `AUTH_PASS` check and `server.listen(...)` run on import. Move them behind a main guard. Replace lines 10–14:

```js
const PASS = process.env.AUTH_PASS
if (!PASS) {
  console.error('AUTH_PASS env var is required')
  process.exit(1)
}
```

with:

```js
const PASS = process.env.AUTH_PASS
```

and replace the listen line (currently `server.listen(PORT, ...)`) with:

```js
const isMain = import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  if (!PASS) {
    console.error('AUTH_PASS env var is required')
    process.exit(1)
  }
  server.listen(PORT, () => console.log(`dl listening on :${PORT}`))
}
```

- [ ] **Step 5: Replace the allowlist with the host→formats map + format set**

Replace the `ALLOWED_HOSTS` array (lines 16–24, includes `open.spotify.com`) with:

```js
const HOST_FORMATS = {
  'youtube.com': ['mp4', 'mp3', 'wav'],
  'youtu.be': ['mp4', 'mp3', 'wav'],
  'tiktok.com': ['mp4', 'mp3', 'wav'],
  'instagram.com': ['mp4', 'mp3', 'wav', 'jpg', 'png'],
  'x.com': ['mp4', 'mp3', 'wav', 'jpg', 'png'],
  'twitter.com': ['mp4', 'mp3', 'wav', 'jpg', 'png'],
}
const ALLOWED_HOSTS = Object.keys(HOST_FORMATS)
const FORMATS = ['mp4', 'mp3', 'wav', 'jpg', 'png']

export { HOST_FORMATS, FORMATS }
export const isValidFormat = (f) => FORMATS.includes(f)
```

- [ ] **Step 6: Add `formatsForHost` and export `hostAllowed`; share host normalization**

Replace the existing `hostAllowed` function (near the bottom) with an exported version, and add `formatsForHost` + a shared `normHost` helper:

```js
export function normHost(raw) {
  let u
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  return u.hostname.replace(/^www\./, '')
}

export function hostAllowed(raw) {
  const host = normHost(raw)
  if (!host) return false
  return ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h))
}

export function formatsForHost(host) {
  const h = (host || '').replace(/^www\./, '')
  for (const key of ALLOWED_HOSTS) {
    if (h === key || h.endsWith('.' + key)) return HOST_FORMATS[key]
  }
  return null
}
```

- [ ] **Step 7: Read and validate `format` in the POST handler**

In `handleDownload`, replace the URL parse + host check preamble so it also handles `format`:

```js
async function handleDownload(res, body) {
  const params = new URLSearchParams(body)
  const url = params.get('url') || ''
  const format = params.get('format') || 'mp4'
  if (!isValidFormat(format)) {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    return res.end('Unsupported format\n')
  }
  if (!hostAllowed(url)) {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    return res.end('Unsupported or invalid URL\n')
  }

  let job
  try {
    job = await download(url, format)
  } catch (err) {
    console.error(err.message)
    res.writeHead(502, { 'Content-Type': 'text/plain' })
    return res.end('Download failed\n')
  }
  // ...unchanged: stream job.file, cleanup job.dir
```

Leave the streaming/cleanup tail of `handleDownload` unchanged.

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all `server.test.mjs` cases + earlier tasks).

- [ ] **Step 9: Smoke-check the server still boots**

Run: `AUTH_PASS=x PORT=8099 timeout 2 npm start`
Expected: logs `dl listening on :8099`, then exits on the timeout with no error.

- [ ] **Step 10: Commit**

```bash
git add server.mjs server.test.mjs
git commit -m "feat: validate format, host->formats map, drop spotify"
```

---

### Task 5: `server.mjs` — fetch-driven page (chips, spinner, blob save, dynamic filtering)

**Files:**
- Modify: `server.mjs` (`PAGE` template — inline CSS + JS)
- Manual verification (browser)

**Interfaces:**
- Consumes: `HOST_FORMATS` (Task 4) — serialized into the page as JSON for client-side chip filtering.
- Produces: the served HTML at `GET /`.

**Design skill:** invoke the `frontend-design` skill before finalizing the CSS. The markup/JS below is a working baseline; frontend-design drives the visual treatment (centered card, spacing, chip styling, spinner, light/dark, responsive) within the constraints (one inline `<style>`, no framework, no network requests).

- [ ] **Step 1: Replace the `PAGE` constant with the chips + fetch UI**

Replace the entire `PAGE` template literal. Baseline (style block intentionally minimal — frontend-design refines it in Step 2). **Do not use backticks or `${}` inside the inline `<script>`** — this string is itself a template literal; only the `HOST_FORMATS` interpolation below is intentional. Use string concatenation in client JS.

```js
const PAGE = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>dl</title>
<style>
 :root{color-scheme:light dark}
 *{box-sizing:border-box}
 body{font:16px system-ui,sans-serif;max-width:34rem;margin:4rem auto;padding:0 1rem}
 form{display:flex;flex-direction:column;gap:.75rem}
 .row{display:flex;gap:.5rem}
 input[type=url]{flex:1;padding:.6rem;font-size:1rem}
 button{padding:.6rem 1rem;font-size:1rem;cursor:pointer}
 .chips{display:flex;flex-wrap:wrap;gap:.5rem}
 .chip{position:relative}
 .chip[hidden]{display:none}
 .chip input{position:absolute;opacity:0;pointer-events:none}
 .chip span{display:inline-block;padding:.4rem .8rem;border:1px solid #8888;border-radius:999px;cursor:pointer;user-select:none}
 .chip input:checked+span{border-color:currentColor;font-weight:600}
 #status{min-height:1.5rem;color:#888}
 #status.err{color:#c33}
 .spin{display:inline-block;width:1em;height:1em;border:2px solid #8888;border-top-color:currentColor;border-radius:50%;animation:s .7s linear infinite;vertical-align:-.15em;margin-right:.4rem}
 @keyframes s{to{transform:rotate(360deg)}}
</style></head>
<body>
<h1>dl</h1>
<form id="f">
 <div class="row">
  <input id="url" name="url" type="url" placeholder="Paste a supported URL" required autofocus>
  <button id="go">Download</button>
 </div>
 <div class="chips" id="chips">
  <label class="chip" data-format="mp4"><input type="radio" name="format" value="mp4" checked><span>MP4</span></label>
  <label class="chip" data-format="mp3"><input type="radio" name="format" value="mp3"><span>MP3</span></label>
  <label class="chip" data-format="wav"><input type="radio" name="format" value="wav"><span>WAV</span></label>
  <label class="chip" data-format="jpg"><input type="radio" name="format" value="jpg"><span>JPG</span></label>
  <label class="chip" data-format="png"><input type="radio" name="format" value="png"><span>PNG</span></label>
 </div>
 <div id="status"></div>
</form>
<p style="color:#888">YouTube · Instagram · TikTok · X</p>
<script>
const HOST_FORMATS = ${JSON.stringify(HOST_FORMATS)};
const ALL = ['mp4','mp3','wav','jpg','png'];
const f = document.getElementById('f');
const url = document.getElementById('url');
const go = document.getElementById('go');
const chips = Array.from(document.querySelectorAll('.chip'));
const status = document.getElementById('status');

function hostOf(v){ try { return new URL(v).hostname.replace(/^www\\./,''); } catch { return ''; } }
function allowedFor(h){
  if(!h) return ALL;
  for(const k in HOST_FORMATS){ if(h===k || h.endsWith('.'+k)) return HOST_FORMATS[k]; }
  return ALL;
}
function refresh(){
  const allowed = allowedFor(hostOf(url.value));
  let selVisible = false;
  for(const c of chips){
    const ok = allowed.includes(c.dataset.format);
    c.hidden = !ok;
    if(ok && c.querySelector('input').checked) selVisible = true;
  }
  if(!selVisible) chips.find(c=>c.dataset.format==='mp4').querySelector('input').checked = true;
}
url.addEventListener('input', refresh);
refresh();

document.addEventListener('keydown', function(e){
  if(e.target === url) return;
  const i = ['1','2','3','4','5'].indexOf(e.key);
  if(i < 0) return;
  const c = chips[i];
  if(c && !c.hidden){ c.querySelector('input').checked = true; }
});

function fileName(cd){
  const m = /filename="?([^"]+)"?/.exec(cd || '');
  return m ? m[1] : 'download';
}
function save(blob, name){
  const a = document.createElement('a');
  const u = URL.createObjectURL(blob);
  a.href = u; a.download = name; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(u);
}
function setStatus(html, isErr){ status.className = isErr ? 'err' : ''; status.innerHTML = html; }

let started = 0, timer = 0;
function tick(){
  const s = Math.floor((performance.now() - started) / 1000);
  const mm = Math.floor(s / 60), ss = String(s % 60).padStart(2,'0');
  setStatus('<span class="spin"></span>Fetching&hellip; ' + mm + ':' + ss);
}

f.addEventListener('submit', async function(e){
  e.preventDefault();
  const fmt = new FormData(f).get('format');
  go.disabled = true;
  started = performance.now();
  tick();
  timer = setInterval(tick, 250);
  try{
    const res = await fetch('/', { method:'POST', body:new URLSearchParams({ url: url.value, format: fmt }) });
    clearInterval(timer);
    if(!res.ok){ setStatus((await res.text()).trim() || 'Download failed', true); return; }
    const blob = await res.blob();
    save(blob, fileName(res.headers.get('Content-Disposition')));
    setStatus('Done.');
  }catch(err){
    clearInterval(timer);
    setStatus('Network error', true);
  }finally{
    go.disabled = false;
  }
});
</script>
</body></html>`
```

- [ ] **Step 2: Run frontend-design on the page**

Invoke the `frontend-design` skill and apply its guidance to the inline `<style>` and markup only — keep the JS behavior, the single-`<style>` rule, no framework, no external requests, and the noindex constraints. Keep it responsive and light/dark aware.

- [ ] **Step 3: Add a server-side page smoke test**

Append to `server.test.mjs`:

```js
import { readFile } from 'node:fs/promises'

test('served page wires chips and fetch script', async () => {
  const src = await readFile(new URL('./server.mjs', import.meta.url), 'utf8')
  for (const f of ['mp4', 'mp3', 'wav', 'jpg', 'png']) {
    assert.ok(src.includes(`value="${f}"`), `chip ${f}`)
  }
  assert.ok(src.includes('JSON.stringify(HOST_FORMATS)'), 'host map injected')
  assert.ok(src.includes("fetch('/'"), 'fetch-based submit')
})
```

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Manual browser check**

Run: `AUTH_PASS=secret npm run setup >/dev/null 2>&1; AUTH_PASS=secret PORT=8099 npm start` (in one terminal), then open `http://localhost:8099` with user `admin` / pass `secret`.

Verify:
- Paste a YouTube URL → only MP4/MP3/WAV chips show; JPG/PNG hidden.
- Paste an Instagram URL → all five chips show.
- Submit with MP4 → spinner + timer runs, then the file saves; status shows "Done."
- Submit a bad URL → inline error text, form re-enabled.
- Resize to a narrow width → layout stays usable (chips wrap, no horizontal scroll).

- [ ] **Step 5: Commit**

```bash
git add server.mjs server.test.mjs
git commit -m "feat: fetch-based UI with format chips, spinner, dynamic filtering"
```

---

### Task 6: Docs cleanup + final end-to-end verification

**Files:**
- Modify: `CLAUDE.md` (backlog section)

- [ ] **Step 1: Update the backlog in `CLAUDE.md`**

In the "Backlog (considered, not built)" section, remove the now-shipped items (**Output format toggle**, **Nicer UI**, **Responsiveness**) and keep only **Spotify support** as parked. Adjust the intro line if needed so it still reads correctly with one remaining item.

- [ ] **Step 2: Full test run**

Run: `npm test`
Expected: PASS — all `zip.test.mjs`, `download.test.mjs`, `server.test.mjs` cases.

- [ ] **Step 3: Final manual E2E matrix (requires `./vendor`)**

With the server running (`AUTH_PASS=secret PORT=8099 npm start`), download one of each and confirm the saved file opens:
- YouTube → MP4 (video plays)
- YouTube → MP3 and WAV (audio plays)
- Instagram/X single photo → JPG and PNG (image opens, correct format)
- Instagram carousel → JPG → a `.zip` that extracts to multiple images

Note any host/format combos that fail so they can be triaged (extractor coverage, not app bugs).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: empty shipped backlog items (formats, UI, responsive)"
```

---

## Self-Review Notes

- **Spec coverage:** format model (Task 2/3/4), spinner/fetch flow (Task 5), better/responsive UI (Task 5 + frontend-design), carousel ZIP (Task 1 + Task 3), spotify cleanup (Task 4 allowlist + Task 5 footer + Task 6 backlog). zip.mjs + tests cover the zip unit; download/server pure helpers are unit-tested; page/orchestration are manually verified (browser + spawned binaries), which is the honest boundary for those layers.
- **Blob-in-memory tradeoff** is intentional and documented in the spec.
- **Multi-file rule** is uniform (">1 file → zip"), not media-type-special-cased, matching the spec.
