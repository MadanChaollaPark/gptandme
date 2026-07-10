#!/usr/bin/env bash
# Build a deterministic Chrome Web Store package.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$ROOT/dist/gptandme.zip"
STAGE="$(mktemp -d)"

FILES=(
  manifest.json
  shared.js
  background.js
  content.js
  inject.js
  popup.html
  popup.js
  privacy.html
  icons/icon16.png
  icons/icon32.png
  icons/icon48.png
  icons/icon128.png
)

cleanup() {
  rm -rf "$STAGE"
}
trap cleanup EXIT

rm -rf "$ROOT/dist"
mkdir -p "$ROOT/dist"

for file in "${FILES[@]}"; do
  mkdir -p "$STAGE/$(dirname "$file")"
  cp "$ROOT/$file" "$STAGE/$file"
  TZ=UTC touch -t 198001010000 "$STAGE/$file"
done

(
  cd "$STAGE"
  zip -X -q "$OUT" "${FILES[@]}"
)

echo "Built: $OUT"
ls -lh "$OUT"
