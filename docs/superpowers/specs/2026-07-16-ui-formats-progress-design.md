# dl.perone.dev — UI, format choice, progress, carousels

**Date:** 2026-07-16
**Status:** Approved, ready for planning

Empties the parked backlog (minus Spotify): nicer responsive UI, a fast
format picker, download progress feedback, and Instagram-carousel support.
Spotify stays out and its dead allowlist entry is removed.

## Goals

1. **Format choice** — pick output per download: MP4 (video), MP3/WAV (audio),
   JPG/PNG (photo posts). Optimized for speed, not a bulky dropdown.
2. **Progress feedback** — a spinner + elapsed timer while yt-dlp runs, since a
   real byte-percentage bar would need a server-side job model (out of scope).
3. **Better UI** — one page, one inline `<style>`, no framework/build; a
   centered card, responsive, that the `frontend-design` skill styles.
4. **Carousels → ZIP** — multi-file posts (IG carousels, multi-image X posts)
   come back as a single `.zip`.
5. **Spotify cleanup** — remove `open.spotify.com` from the allowlist and the
   footer; yt-dlp can't fetch it (DRM), so it only ever produced
   "Download failed" and misled.

Non-goals (unchanged YAGNI): job queue, accounts, DB, history, real % bars,
transcoding options beyond the fixed format list, an API, Spotify support.

## Architecture

Files stay as they are — no new modules beyond a small zip helper:

- `server.mjs` — HTTP, auth, routing, the HTML page (with inline CSS + JS),
  request handling, response streaming.
- `download.mjs` — spawns yt-dlp/ffmpeg; now takes a `format` argument and
  branches on it; decides single-file vs zip.
- **New:** `zip.mjs` — a minimal store-method ZIP writer (zero-dep). Kept
  separate because it is a self-contained, independently-testable unit with one
  job: turn a list of `{name, path}` into a `.zip` stream/buffer.

### Request flow (fetch-based)

1. `GET /` → the single page (behind Basic auth), including inline CSS + JS.
2. Client JS intercepts the form submit, POSTs `url` + `format` via `fetch`,
   and shows an indeterminate spinner + elapsed timer.
3. `POST /` validates host (allowlist) and `format` (fixed set), then calls
   `download(url, format)`.
4. `download` runs yt-dlp (+ ffmpeg for audio/image conversion) into a temp dir.
   - Exactly one output file → return that file.
   - More than one output file → zip them all → return the `.zip`.
5. Server streams the result with `Content-Disposition: attachment`, then
   deletes the temp dir.
6. Client reads the response blob, parses the filename from
   `Content-Disposition`, and triggers a save via an object URL. On a non-200,
   it reads the body text and shows it inline as an error.

**Tradeoff (accepted):** `fetch` buffers the whole response as a blob in browser
memory — a large video becomes a large blob. Acceptable for a single-user tool;
it is the price of showing a spinner instead of a bare page wait.

## Format model

The form sends a single `format` field. `download(url, format)` maps it:

| `format` | yt-dlp / ffmpeg | Output |
|----------|-----------------|--------|
| `mp4` (default) | `-f bv*+ba/b -S ext:mp4:m4a --merge-output-format mp4` | one `.mp4` |
| `mp3` | `-x --audio-format mp3 --audio-quality 0` | one `.mp3` |
| `wav` | `-x --audio-format wav` | one `.wav` |
| `jpg` | download post image(s); ffmpeg-convert each to `.jpg` if src ext differs | image, or `.zip` if >1 |
| `png` | download post image(s); ffmpeg-convert each to `.png` if src ext differs | image, or `.zip` if >1 |

- The existing shared flags stay: `--no-playlist --no-progress
  --restrict-filenames --js-runtimes node:<execPath> -o <dir>/%(title).150s.%(ext)s`.
- `-x` removes the intermediate video, so audio modes yield one file.
- Image conversion runs only when the downloaded extension differs from the
  chosen one (e.g. source `.webp` + choice `jpg` → convert; source already
  `.jpg` + choice `jpg` → skip). Uses the vendored `ffmpeg` already on the
  child `PATH`: `ffmpeg -i <src> -y <dst>`.
- An incompatible combination (e.g. `mp3` on an image-only post) yields a
  yt-dlp error → the existing generic "Download failed" response. Not special-cased.

### Single-file vs ZIP (uniform rule)

After yt-dlp (and any per-image conversion), read the temp dir:

- **1 file** → return it as today.
- **>1 files** → zip all of them → return `<basename>.zip`. This covers IG
  carousels, multi-image X posts, and any multi-file result. Not special-cased
  by media type — the rule is purely "more than one file."

The zip name derives from the post: reuse the common prefix / title token from
the produced filenames, falling back to `download.zip`.

## UI

Speed is the whole point. No dropdown.

- **Layout:** one centered card. Title, a URL input (autofocus), a row of
  format **radio chips**, a download button, and a status region below.
  One inline `<style>`, no framework, no build. Responsive / mobile-friendly.
  `frontend-design` skill drives the actual visual treatment.
- **Format chips:** flat radio group — `MP4` `MP3` `WAV` `JPG` `PNG`, with
  `MP4` preselected. Fastest path: paste URL → Enter → MP4. Want audio? one
  click `MP3` → Enter.
- **Optional (nice-to-have):** number-key shortcuts (1–5) to select a chip.
- **Dynamic offering (client-side host regex):** as the URL changes, detect its
  host and show only the chips that host supports. This is a **UX filter only**;
  the server allowlist + format validation remain the security source of truth.

  | Host | Chips |
  |------|-------|
  | youtube.com / youtu.be | MP4 · MP3 · WAV |
  | tiktok.com | MP4 · MP3 · WAV |
  | instagram.com | MP4 · MP3 · WAV · JPG · PNG |
  | x.com / twitter.com | MP4 · MP3 · WAV · JPG · PNG |
  | unrecognized / empty | all chips shown |

  If the currently-selected chip becomes hidden (host change), reset selection
  to `MP4`.
- **Status region states:** idle (empty) → running (spinner + elapsed `m:ss`) →
  done (brief confirmation; the browser save is triggered) or error (the
  server's message text).
- **Headers unchanged:** `X-Robots-Tag: noindex, nofollow`, `robots.txt`
  disallow-all, `<meta name="robots" ...>`.

## zip.mjs — minimal store-method ZIP

Zero-dependency, using Node 24's built-in `zlib.crc32`.

- **Input:** an ordered list of `{ name, path }` (name = entry filename inside
  the archive; path = temp-dir file to read).
- **Method:** store only (compression method `0`) — jpg/png/mp4 are already
  compressed, so deflate buys ~nothing and adds complexity. Compressed size ==
  uncompressed size.
- **Structure:** for each entry emit a Local File Header (`0x04034b50`) +
  raw bytes; then the Central Directory (one `0x02014b50` record per entry);
  then the End Of Central Directory record (`0x06054b50`).
- **CRC-32:** per entry via `zlib.crc32(buffer)`.
- **Sizes/offsets:** track byte offsets as records are written to fill the
  central-directory fields.
- **Mod time/date:** a fixed constant is fine (no meaningful value for this
  tool; avoids a needless `Date` dependency in the writer).
- **Output:** returns a Buffer (or writes to a path) that `download.mjs` hands
  back for streaming. Buffer is simplest given files are already on disk and
  sizes are modest for image carousels.

## Error handling

- Invalid/disallowed host → 400, plain text (as today).
- Unknown `format` value → 400, plain text.
- yt-dlp / ffmpeg / zip failure → 502, generic "Download failed" (stderr tail
  logged server-side, as today).
- Client: non-200 → read body text, show inline in the status region; re-enable
  the form.

## Testing

- `zip.mjs`: unit test — build a zip from 2–3 known files, verify it unzips
  (via `unzip`/`ffmpeg`/Node) to byte-identical originals; verify CRCs and the
  EOCD entry count.
- `download.mjs`: format-to-args mapping is pure and unit-testable — assert the
  argv built for each `format`. The single-vs-zip decision is testable by
  pointing it at a temp dir with 1 vs N files (mock/stub the spawn).
- Host→chips map: pure function, unit-testable with representative URLs
  (including `www.`, `youtu.be`, query strings).
- Manual: end-to-end against one URL per host/format, plus an IG carousel → zip.

## Cleanup

- Remove `open.spotify.com` from `ALLOWED_HOSTS` and drop "Spotify" from the
  footer/host hint text.
