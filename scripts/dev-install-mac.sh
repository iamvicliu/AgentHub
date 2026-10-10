#!/usr/bin/env bash
set -euo pipefail

# Build AgentHub from source and install it into /Applications.
# Intended for developer machines (Apple silicon or Intel, unsigned local builds).
# Run from repo root: bash scripts/dev-install-mac.sh

[[ "$(uname)" == "Darwin" ]] || { echo "dev-install-mac: macOS only"; exit 1; }

cd "$(dirname "$0")/.."

APP_NAME="AgentHub"
DEST="/Applications/${APP_NAME}.app"
if [[ "$(uname -m)" == "arm64" ]]; then
  PACKAGE_SCRIPT="package:mac"
  BUILT="apps/app/dist/mac-arm64/${APP_NAME}.app"
else
  PACKAGE_SCRIPT="package:mac:x64"
  BUILT="apps/app/dist/mac/${APP_NAME}.app"
fi

echo "==> Quitting running ${APP_NAME}…"
osascript -e "quit app \"${APP_NAME}\"" 2>/dev/null || true

echo "==> Building (pnpm run ${PACKAGE_SCRIPT})…"
pnpm run "$PACKAGE_SCRIPT"

[[ -d "$BUILT" ]] || { echo "dev-install-mac: build output not found at $BUILT"; exit 1; }

echo "==> Installing to ${DEST}…"
rm -rf "$DEST"
# ditto keeps the code signature intact; cp -R can break it.
ditto "$BUILT" "$DEST"

# Unsigned local builds trigger Gatekeeper; strip quarantine so `open` just works.
xattr -rd com.apple.quarantine "$DEST" 2>/dev/null || true

echo "==> Launching…"
open "$DEST"
