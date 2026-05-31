#!/bin/bash
# pack-win.sh — Build Windows package with correct native modules
#
# Problem: electron-builder rebuilds native modules for the HOST platform (Linux),
# but we need Windows binaries. This script:
#   1. Builds TypeScript
#   2. Backs up Linux native modules
#   3. Replaces them with pre-downloaded Windows prebuilds
#   4. Runs electron-builder with npmRebuild=false
#   5. Restores Linux modules

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "[pack-win] Step 1: Build TypeScript..."
npm run build

echo "[pack-win] Step 2: Prepare Windows native modules..."
node scripts/prepare-win-native.js

echo "[pack-win] Step 3: Replace Linux native modules with Windows versions..."

# better-sqlite3: backup Linux, copy Windows prebuild
# Dynamically find the Windows prebuild (ABI version varies by Electron version)
SQLITE3_BUILD="node_modules/better-sqlite3/build/Release/better_sqlite3.node"
SQLITE3_BACKUP="node_modules/better-sqlite3/build/Release/better_sqlite3.node.linux-backup"
SQLITE3_WIN=$(ls node_modules/better-sqlite3/prebuilds/electron-v*-win32-x64/better_sqlite3.napi.node 2>/dev/null | head -1)

if [ -f "$SQLITE3_BUILD" ] && [ -f "$SQLITE3_WIN" ]; then
  cp "$SQLITE3_BUILD" "$SQLITE3_BACKUP"
  cp "$SQLITE3_WIN" "$SQLITE3_BUILD"
  echo "[pack-win] Replaced better-sqlite3 with Windows binary"
else
  echo "[pack-win] WARNING: Cannot replace better-sqlite3 (files missing)"
fi

# node-screenshots: backup Linux, copy Windows
SCREENSHOTS_BUILD="node_modules/node-screenshots/node-screenshots.linux-x64-gnu.node"
SCREENSHOTS_BACKUP="node_modules/node-screenshots/node-screenshots.linux-x64-gnu.node.linux-backup"
SCREENSHOTS_WIN="node_modules/node-screenshots-win32-x64-msvc/node-screenshots.win32-x64-msvc.node"

if [ -f "$SCREENSHOTS_BUILD" ] && [ -f "$SCREENSHOTS_WIN" ]; then
  cp "$SCREENSHOTS_BUILD" "$SCREENSHOTS_BACKUP"
  cp "$SCREENSHOTS_WIN" "$SCREENSHOTS_BUILD"
  echo "[pack-win] Replaced node-screenshots with Windows binary"
else
  echo "[pack-win] NOTE: node-screenshots platform-specific handling (may be ok)"
fi

# sharp: backup Linux, ensure Windows prebuild is available
SHARP_LINUX="node_modules/@img/sharp-linux-x64"
SHARP_LINUX_BACKUP="node_modules/@img/sharp-linux-x64.linux-backup"
SHARP_WIN="node_modules/@img/sharp-win32-x64"

if [ -d "$SHARP_LINUX" ] && [ -d "$SHARP_WIN" ]; then
  mv "$SHARP_LINUX" "$SHARP_LINUX_BACKUP"
  echo "[pack-win] Backed up sharp Linux module"
else
  echo "[pack-win] WARNING: Cannot swap sharp modules (linux=$([ -d "$SHARP_LINUX" ] && echo 'yes' || echo 'no'), win=$([ -d "$SHARP_WIN" ] && echo 'yes' || echo 'no'))"
fi

echo "[pack-win] Step 4: Package with electron-builder (skip rebuild)..."
npx electron-builder --win --config.npmRebuild=false

echo "[pack-win] Step 5: Restore Linux native modules..."
if [ -f "$SQLITE3_BACKUP" ]; then
  mv "$SQLITE3_BACKUP" "$SQLITE3_BUILD"
  echo "[pack-win] Restored better-sqlite3 Linux binary"
fi
if [ -f "$SCREENSHOTS_BACKUP" ]; then
  mv "$SCREENSHOTS_BACKUP" "$SCREENSHOTS_BUILD"
  echo "[pack-win] Restored node-screenshots Linux binary"
fi

# Restore sharp Linux module
if [ -d "$SHARP_LINUX_BACKUP" ]; then
  mv "$SHARP_LINUX_BACKUP" "$SHARP_LINUX"
  echo "[pack-win] Restored sharp Linux module"
fi

echo "[pack-win] Done! Windows package in release/"
