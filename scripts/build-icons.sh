#!/usr/bin/env bash
# Builds every copy of the logo from resources/icon.svg, the xrn family design:
# the PNG (Linux, the tray, Google's consent screen), the ICO (Windows installer,
# taskbar and tray) and the marks the README and the website show. A change to
# the logo starts in that SVG and ends with this script; tests/logo.test.ts fails
# if the ICO or a mark is left behind. Needs rsvg-convert and ImageMagick.
set -euo pipefail
cd "$(dirname "$0")/.."

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

rsvg-convert -w 512 -h 512 resources/icon.svg -o resources/icon.png

# The six sizes Windows asks for, as uncompressed bitmaps like the file this
# replaced: ImageMagick would otherwise PNG-compress the largest.
sizes=(256 128 64 48 32 16)
frames=()
for size in "${sizes[@]}"; do
  rsvg-convert -w "$size" -h "$size" resources/icon.svg -o "$work/$size.png"
  frames+=("$work/$size.png")
done
magick "${frames[@]}" -compress none resources/icon.ico

# The marks have the tile edge to edge: the icon's margin is there for the OS.
for mark in site/mark.svg docs/assets/mark.svg; do
  sed -E 's|<svg [^>]*>|<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="xrncal">|' \
    resources/icon.svg > "$mark"
done
