#!/usr/bin/env bash
# Fetch the yt-dlp and ffmpeg binaries into ./vendor (Linux x86_64).
# The app auto-detects ./vendor and puts it on PATH for the spawned yt-dlp.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
vendor="$root/vendor"
mkdir -p "$vendor"

echo "Fetching yt-dlp..."
curl -fL --retry 3 \
  https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
  -o "$vendor/yt-dlp"
chmod +x "$vendor/yt-dlp"

echo "Fetching ffmpeg (static)..."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fL --retry 3 \
  https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
  -o "$tmp/ffmpeg.tar.xz"
tar -xJf "$tmp/ffmpeg.tar.xz" -C "$tmp"
d="$(find "$tmp" -maxdepth 1 -type d -name 'ffmpeg-*' | head -1)"
cp "$d/ffmpeg" "$d/ffprobe" "$vendor/"

echo
echo "Done. Binaries in $vendor:"
"$vendor/yt-dlp" --version
"$vendor/ffmpeg" -version | head -1
