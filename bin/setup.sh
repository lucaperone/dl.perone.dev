#!/usr/bin/env bash
# Fetch the yt-dlp and ffmpeg binaries into ./vendor.
# Runs as the Infomaniak "build command" (boosted resources) or by hand.
# The app auto-detects ./vendor and puts it on PATH for the spawned yt-dlp.
set -euo pipefail

for tool in curl tar; do
  command -v "$tool" >/dev/null || { echo "ERROR: '$tool' not found in PATH" >&2; exit 1; }
done

arch="$(uname -m)"
case "$arch" in
  x86_64|amd64) YTDLP_ASSET=yt-dlp_linux; FFMPEG_ARCH=amd64 ;;
  aarch64|arm64) YTDLP_ASSET=yt-dlp_linux_aarch64; FFMPEG_ARCH=arm64 ;;
  *) echo "ERROR: unsupported arch '$arch'" >&2; exit 1 ;;
esac

root="$(cd "$(dirname "$0")/.." && pwd)"
vendor="$root/vendor"
mkdir -p "$vendor"

echo "Fetching yt-dlp ($YTDLP_ASSET)..."
curl -fL --retry 3 \
  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/$YTDLP_ASSET" \
  -o "$vendor/yt-dlp"
chmod +x "$vendor/yt-dlp"

echo "Fetching ffmpeg (static, $FFMPEG_ARCH)..."
command -v xz >/dev/null || echo "WARN: 'xz' not found; tar may fail to unpack .tar.xz" >&2
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fL --retry 3 \
  "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-${FFMPEG_ARCH}-static.tar.xz" \
  -o "$tmp/ffmpeg.tar.xz"
tar -xf "$tmp/ffmpeg.tar.xz" -C "$tmp"
d="$(find "$tmp" -maxdepth 1 -type d -name 'ffmpeg-*' | head -1)"
cp "$d/ffmpeg" "$d/ffprobe" "$vendor/"

echo
echo "Done. Binaries in $vendor:"
"$vendor/yt-dlp" --version
"$vendor/ffmpeg" -version | head -1
