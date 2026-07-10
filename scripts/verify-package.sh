#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCHIVE="$ROOT/dist/gptandme.zip"
EXPECTED="$(mktemp)"
ACTUAL="$(mktemp)"

cleanup() {
  rm -f "$EXPECTED" "$ACTUAL"
}
trap cleanup EXIT

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

"$ROOT/build.sh" >/dev/null

printf '%s\n' "${FILES[@]}" | LC_ALL=C sort > "$EXPECTED"
unzip -Z1 "$ARCHIVE" | LC_ALL=C sort > "$ACTUAL"
diff -u "$EXPECTED" "$ACTUAL"

PACKAGE_VERSION="$(cd "$ROOT" && node -p 'require("./package.json").version')"
MANIFEST_VERSION="$(unzip -p "$ARCHIVE" manifest.json | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).version')"

if [[ "$PACKAGE_VERSION" != "$MANIFEST_VERSION" ]]; then
  echo "Version mismatch: package=$PACKAGE_VERSION manifest=$MANIFEST_VERSION" >&2
  exit 1
fi

echo "Verified GPTandME $MANIFEST_VERSION package"
shasum -a 256 "$ARCHIVE"
