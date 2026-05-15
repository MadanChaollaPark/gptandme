#!/usr/bin/env bash
# Build a clean zip for Chrome Web Store submission.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/dist/gptandme.zip"

rm -rf "$DIR/dist"
mkdir -p "$DIR/dist"

cd "$DIR"
zip -j "$OUT" \
  manifest.json \
  shared.js \
  background.js \
  content.js \
  popup.html \
  popup.js \
  privacy.html

# Add only the required icons (exclude stock photos)
cd "$DIR"
zip "$OUT" \
  icons/icon16.png \
  icons/icon32.png \
  icons/icon48.png \
  icons/icon128.png

echo ""
echo "Built: $OUT"
ls -lh "$OUT"
