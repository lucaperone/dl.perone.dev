import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const vendor = join(root, 'vendor')
const hasVendor = existsSync(vendor)

const YTDLP =
  process.env.YTDLP_PATH ||
  (existsSync(join(vendor, 'yt-dlp')) ? join(vendor, 'yt-dlp') : 'yt-dlp')

// Prepend vendor/ so a vendored ffmpeg is found for muxing.
const childEnv = hasVendor
  ? { ...process.env, PATH: `${vendor}:${process.env.PATH ?? ''}` }
  : process.env

const TIMEOUT = Number(process.env.DOWNLOAD_TIMEOUT_MS || 600_000)

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

// Download `url` into a fresh temp dir. Returns { dir, file }; the caller
// streams `file` to the client, then removes `dir`.
export async function download(url) {
  const dir = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'dl-'))
  try {
    await run(YTDLP, [
      '--no-playlist',
      '--no-progress',
      '--restrict-filenames',
      // YouTube extraction now requires a JS runtime; reuse this Node.
      '--js-runtimes', `node:${process.execPath}`,
      '-f', 'bv*+ba/b',
      '-S', 'ext:mp4:m4a',
      '--merge-output-format', 'mp4',
      '-o', join(dir, '%(title).150s.%(ext)s'),
      url,
    ])
    const files = await readdir(dir)
    if (files.length === 0) throw new Error('yt-dlp produced no file')
    return { dir, file: join(dir, files[0]) }
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    throw err
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: childEnv,
      timeout: TIMEOUT,
      killSignal: 'SIGKILL',
    })
    let err = ''
    p.stderr.on('data', (d) => {
      err += d
    })
    p.on('error', reject)
    p.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`yt-dlp exited ${code}: ${err.slice(-500)}`)),
    )
  })
}
