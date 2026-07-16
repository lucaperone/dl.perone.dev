import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipBuffers } from './zip.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const vendor = join(root, 'vendor')
const hasVendor = existsSync(vendor)

const YTDLP =
  process.env.YTDLP_PATH ||
  (existsSync(join(vendor, 'yt-dlp')) ? join(vendor, 'yt-dlp') : 'yt-dlp')

const FFMPEG =
  process.env.FFMPEG_PATH ||
  (existsSync(join(vendor, 'ffmpeg')) ? join(vendor, 'ffmpeg') : 'ffmpeg')

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
