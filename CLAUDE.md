# dl.perone.dev

Personal, single-user `yt-dlp` web wrapper. Paste one supported URL, get one
media file back. Runs on my Infomaniak server (Node 24/25).

## Purpose & scope

- **One URL in → one media file out.** That is the whole product.
- Private tool for my own use. Not a public service.
- Explicitly **out of scope** (YAGNI): playlists, batch/queue, accounts, a
  database, download history, format pickers, transcoding options, an API,
  mobile app, real-time progress bars. Add none of this without a concrete need.

## Non-negotiable constraints

- **No index, no robots.** `robots.txt` disallows everything; every response
  sends `X-Robots-Tag: noindex, nofollow`. No sitemap, no meta previews.
- **No bloated UI.** One HTML page, one form (URL + submit). Inline CSS, no
  framework, no build step for the frontend.
- **No ads, no trackers, no third-party requests** from the page.
- **Auth required.** The box is public, so the endpoint is gated behind a
  single shared secret (HTTP Basic or a signed cookie) from an env var. An open
  yt-dlp proxy is an abuse magnet — never ship it unauthenticated.

## Philosophy

**KISS and YAGNI, strictly.** Prefer the boring, built-in solution. Every
dependency and every feature must justify its existence. When in doubt, leave
it out.

## Stack

- **Node 24 LTS**, plain ESM JavaScript (`.mjs`). No TypeScript build, no
  bundler, no transpile step.
- **Zero runtime dependencies** as the target. Use the standard library:
  `node:http`, `node:child_process`, `node:crypto`, `node:stream`,
  `node:fs/promises`, `node:os`, `node:path`. Only add a dependency if the
  stdlib genuinely cannot do the job.
- **`yt-dlp` binary** (+ `ffmpeg` for muxing). Fetched by `bin/setup.sh` into
  `./vendor/` (gitignored); the app auto-detects that dir and puts it on the
  child `PATH`. Falls back to whatever `yt-dlp`/`ffmpeg` is on `PATH`. The app
  spawns them; it does not vendor into git or reimplement them.

## Run

```sh
npm run setup            # fetch yt-dlp + ffmpeg into ./vendor (Linux x86_64)
cp .env.example .env     # set AUTH_PASS at minimum
npm start                # node --env-file-if-exists=.env server.mjs
```

## How it works (intended flow)

1. `GET /` → the single form page (behind auth).
2. `POST /` with a URL → validate it against a small allowlist of supported
   hosts, reject anything else.
3. Spawn `yt-dlp` to download into a per-request temp dir.
4. Stream the resulting file to the client with `Content-Disposition:
   attachment`, then delete the temp dir.
5. One request, one file, synchronous. No job queue.

## Conventions

- Edit existing files over adding new ones; keep the file count low.
- Default to no comments; comment only a non-obvious *why*.
- No dead code, no compat shims, no "removed" markers — delete instead.
- Validate only at the true edge (the submitted URL, auth). Trust internal code.
- Secrets and config come from env vars, never committed. See `.env.example`
  once it exists.

## Deploy (Infomaniak Node.js hosting)

Managed Node app (not a VPS). Configured in the Manager dashboard; the app is a
long-lived process behind Infomaniak's reverse proxy (TLS terminated upstream).

- **Execution folder:** repo root (has `package.json`).
- **Build command:** `npm run setup` — fetches yt-dlp + ffmpeg into `./vendor/`
  with boosted build-tier resources. Runs on every deploy.
- **Start command:** `npm start` (`node --env-file-if-exists=.env server.mjs`).
- **Port:** the Manager assigns `PORT`; the app reads `process.env.PORT`.
- **Node version:** 24 LTS, selected in the Manager.
- **Secret:** custom env vars aren't guaranteed in the Manager, so put
  `AUTH_USER`/`AUTH_PASS` in a server-side `.env` (SFTP/SSH, gitignored). A
  `git pull` deploy preserves the untracked `.env`.
- The throttled SSH shell is for admin only; the managed app tier is where the
  process actually runs (yt-dlp/ffmpeg included).

## Repo

- Private GitHub repo, personal SSH identity (`luca@perone.dev`).
- Confirm before pushing to any remote or opening PRs.
