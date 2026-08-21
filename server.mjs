import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { download } from './download.mjs'

const PORT = Number(process.env.PORT || 8080)
const USER = process.env.AUTH_USER || 'admin'
const PASS = process.env.AUTH_PASS

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

const PAGE = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>dl</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%2314131b'/><text x='16' y='23' text-anchor='middle' fill='%23e8e3d8' font-family='ui-monospace,SFMono-Regular,Menlo,monospace' font-size='20' font-weight='700'>d<tspan fill='%23ffb454'>l</tspan></text></svg>">
<style>
 :root{
  --bg:#14131b; --surface:#1d1b26; --fg:#e8e3d8; --muted:#8f8a9e;
  --accent:#ffb454; --danger:#ff6b6b; --line:#2c2937;
  color-scheme:dark light;
 }
 @media (prefers-color-scheme:light){
  :root{ --bg:#f6f3ea; --surface:#fffdf7; --fg:#221f1a; --muted:#6b6558;
         --accent:#b4600a; --danger:#c0392b; --line:#e3ddcd; }
 }
 *{box-sizing:border-box}
 html,body{height:100%}
 body{
  margin:0; background:var(--bg); color:var(--fg);
  font:15px/1.5 ui-monospace,"SF Mono","JetBrains Mono","Cascadia Code",Menlo,Consolas,monospace;
  display:grid; place-items:center; padding:1.5rem;
 }
 main{width:100%; max-width:40rem}
 .head{display:flex; align-items:baseline; justify-content:space-between; margin-bottom:1.25rem}
 .brand{font-size:1.9rem; font-weight:700; letter-spacing:.12em}
 .brand b{color:var(--accent)}
 .hint{color:var(--muted); font-size:.8rem; letter-spacing:.04em}
 form{display:flex; flex-direction:column; gap:.9rem}
 .prompt{display:flex; flex-wrap:wrap; align-items:center; gap:.6rem; border-bottom:1px solid var(--line); padding:.4rem 0}
 .prompt:focus-within{border-color:var(--accent)}
 .caret{color:var(--accent); font-weight:700; animation:blink 1.1s step-end infinite}
 @keyframes blink{50%{opacity:.2}}
 #url{flex:1; min-width:0; background:none; border:0; outline:none; color:var(--fg);
      font:inherit; caret-color:var(--accent); padding:.3rem 0}
 #url::placeholder{color:var(--muted)}
 #go{font:inherit; color:var(--accent); background:none; border:1px solid var(--accent);
     border-radius:2px; padding:.35rem .9rem; cursor:pointer; transition:background .12s,color .12s}
 #go:hover,#go:focus-visible{background:var(--accent); color:var(--bg); outline:none}
 #go:disabled{opacity:.5; cursor:progress}
 .flags{display:flex; flex-wrap:wrap; gap:.5rem}
 .flag input{position:absolute; width:1px; height:1px; opacity:0; clip:rect(0 0 0 0)}
 .flag span{display:inline-block; color:var(--muted); padding:.25rem .55rem;
            border:1px solid transparent; border-radius:2px; cursor:pointer}
 .flag span:hover{color:var(--fg)}
 .flag input:checked+span{color:var(--accent); border-color:var(--accent)}
 .flag input:focus-visible+span{outline:2px solid var(--accent); outline-offset:2px}
 .flag[hidden]{display:none}
 .status{min-height:1.4rem; color:var(--muted); font-size:.9rem; word-break:break-word}
 .status.err{color:var(--danger)}
 .status .t{color:var(--accent)}
 .sites{margin-top:1.5rem; color:var(--muted); font-size:.78rem; letter-spacing:.06em}
 @media (prefers-reduced-motion:reduce){ .caret{animation:none} }
 @media (max-width:30rem){ #go{width:100%} }
</style></head>
<body>
<main>
 <div class="head"><span class="brand">d<b>l</b></span><span class="hint">paste · pick · &#9166;</span></div>
 <form id="f">
  <div class="prompt">
   <span class="caret">&#10095;</span>
   <input id="url" name="url" type="url" placeholder="paste a link" required autofocus autocomplete="off" spellcheck="false">
   <button id="go">get</button>
  </div>
  <div class="flags" id="chips">
   <label class="flag" data-format="mp4"><input type="radio" name="format" value="mp4" checked><span>--mp4</span></label>
   <label class="flag" data-format="mp3"><input type="radio" name="format" value="mp3"><span>--mp3</span></label>
   <label class="flag" data-format="wav"><input type="radio" name="format" value="wav"><span>--wav</span></label>
   <label class="flag" data-format="jpg"><input type="radio" name="format" value="jpg"><span>--jpg</span></label>
   <label class="flag" data-format="png"><input type="radio" name="format" value="png"><span>--png</span></label>
  </div>
  <div id="status" class="status" aria-live="polite"></div>
 </form>
 <div class="sites">youtube · instagram · tiktok · x</div>
</main>
<script>
const HOST_FORMATS = ${JSON.stringify(HOST_FORMATS)};
const ALL = ['mp4','mp3','wav','jpg','png'];
const FRAMES = ['\\u280b','\\u2819','\\u2839','\\u2838','\\u283c','\\u2834','\\u2826','\\u2827','\\u2807','\\u280f'];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const f = document.getElementById('f');
const url = document.getElementById('url');
const go = document.getElementById('go');
const chips = Array.from(document.querySelectorAll('.flag'));
const statusEl = document.getElementById('status');

function allowedFor(v){
  let u; try { u = new URL(v); } catch { return ALL; }
  const h = u.hostname.replace(/^www\\./,'');
  const insta = h === 'instagram.com' || h.endsWith('.instagram.com');
  if(insta && (u.pathname.startsWith('/reel/') || u.pathname.startsWith('/reels/'))) return ['mp4','mp3','wav'];
  for(const k in HOST_FORMATS){ if(h===k || h.endsWith('.'+k)) return HOST_FORMATS[k]; }
  return ALL;
}
function refresh(){
  const allowed = allowedFor(url.value);
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
  if(c && !c.hidden) c.querySelector('input').checked = true;
});

function elapsed(ms){
  const s = Math.floor(ms/1000);
  return Math.floor(s/60) + ':' + String(s%60).padStart(2,'0');
}
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
function set(html, cls){ statusEl.className = 'status' + (cls ? ' ' + cls : ''); statusEl.innerHTML = html; }
function esc(s){ return s.replace(/[&<>]/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;' }[c] }) }

let started = 0, timer = 0, frame = 0;
function tick(){
  const g = reduce ? '\\u00b7' : FRAMES[frame++ % FRAMES.length];
  set(g + ' fetching&hellip; <span class="t">' + elapsed(performance.now() - started) + '</span>');
}

f.addEventListener('submit', async function(e){
  e.preventDefault();
  const fmt = new FormData(f).get('format');
  go.disabled = true;
  started = performance.now(); frame = 0; tick();
  timer = setInterval(tick, reduce ? 1000 : 90);
  try{
    const res = await fetch('/', { method:'POST', body:new URLSearchParams({ url: url.value, format: fmt }) });
    clearInterval(timer);
    if(!res.ok){ set('\\u2717 ' + esc((await res.text()).trim() || 'download failed'), 'err'); return; }
    const blob = await res.blob();
    const name = fileName(res.headers.get('Content-Disposition'));
    save(blob, name);
    set('\\u2713 saved <span class="t">' + esc(name) + '</span>');
  }catch(err){
    clearInterval(timer);
    set('\\u2717 network error', 'err');
  }finally{
    go.disabled = false;
  }
});
</script>
</body></html>`

export const server = createServer((req, res) => {
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

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  if (!PASS) {
    console.error('AUTH_PASS env var is required')
    process.exit(1)
  }
  server.listen(PORT, () => console.log(`dl listening on :${PORT}`))
}

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
  if (!formatsForUrl(url).includes(format)) {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    return res.end('Unsupported format for this site\n')
  }

  let job
  try {
    job = await download(url, format)
  } catch (err) {
    console.error(err.message)
    res.writeHead(502, { 'Content-Type': 'text/plain' })
    return res.end(`${err.message}\n`)
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
  stream.on('error', () => {
    if (!res.destroyed) res.destroy()
    cleanup()
  })
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

// Like formatsForHost, but path-aware: an Instagram reel is video-only, so it
// drops the photo formats a general /p/ post would offer.
export function formatsForUrl(raw) {
  const base = formatsForHost(normHost(raw))
  if (!base) return null
  let u
  try {
    u = new URL(raw)
  } catch {
    return base
  }
  const h = normHost(raw)
  const insta = h === 'instagram.com' || h.endsWith('.instagram.com')
  if (insta && (u.pathname.startsWith('/reel/') || u.pathname.startsWith('/reels/'))) {
    return base.filter((fmt) => fmt !== 'jpg' && fmt !== 'png')
  }
  return base
}
