#!/usr/bin/env bash
# Rebuild the app icon from an SVG on the macOS 1024 grid.
#   scripts/icon/build.sh apps/desktop/assets/icon/concepts/ink-r.svg
# Needs ImageMagick, python3, and playwright-core with a Chromium
# (PLAYWRIGHT_CHROMIUM points at the executable).
# concepts.py regenerates the three concept SVGs: python3 scripts/icon/concepts.py <dir>
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
svg="$1"
out="$here/../../apps/desktop/assets/icon"
tmp="$(mktemp -d)"
bun "$here/render.mjs" "$svg" "$tmp/1024.png" 1024
rm -rf "$out/icon.iconset" && mkdir -p "$out/icon.iconset"
for s in 16 32 128 256 512; do
  convert "$tmp/1024.png" -filter Lanczos -resize "${s}x${s}" -strip "$out/icon.iconset/icon_${s}x${s}.png"
  convert "$tmp/1024.png" -filter Lanczos -resize "$((s * 2))x$((s * 2))" -strip "$out/icon.iconset/icon_${s}x${s}@2x.png"
done
cp "$svg" "$out/icon.svg"
cp "$out/icon.iconset/icon_256x256@2x.png" "$out/icon.png"
python3 "$here/mkicns.py" "$out/icon.iconset" "$out/icon.icns"
rm -rf "$tmp"
