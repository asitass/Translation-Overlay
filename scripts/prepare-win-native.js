#!/usr/bin/env node
/**
 * Prepare Windows native modules for cross-platform packaging.
 *
 * Usage: node scripts/prepare-win-native.js
 *
 * This script downloads/replaces native .node binaries with Windows versions
 * so that electron-builder can package them correctly for Windows.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// --- better-sqlite3 ---
function prepareBetterSqlite3() {
  const pkgPath = path.join(ROOT, 'node_modules', 'better-sqlite3');
  const pkg = require(path.join(pkgPath, 'package.json'));
  const version = pkg.version;

  // Electron v33 -> Node ABI v133
  const electronVersion = require(path.join(ROOT, 'node_modules', 'electron', 'package.json')).version;
  const abiVersion = getElectronAbi(electronVersion);

  const prebuildDir = path.join(pkgPath, 'prebuilds', `electron-v${abiVersion}-win32-x64`);
  const targetFile = path.join(prebuildDir, 'better_sqlite3.napi.node');

  if (fs.existsSync(targetFile)) {
    console.log(`[prepare-win] better-sqlite3 prebuild already exists: ${targetFile}`);
    return;
  }

  const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${version}/better-sqlite3-v${version}-electron-v${abiVersion}-win32-x64.tar.gz`;
  console.log(`[prepare-win] Downloading better-sqlite3 v${version} for Windows Electron ABI ${abiVersion}...`);
  console.log(`[prepare-win] URL: ${url}`);

  // Download and extract
  const tmpDir = path.join(ROOT, '.tmp-win-prebuild');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, 'better-sqlite3-win.tar.gz');

  const proxyArg = process.env.HTTPS_PROXY ? ` --proxy ${process.env.HTTPS_PROXY}` : '';
  execSync(`curl -L -o "${tmpFile}" "${url}"${proxyArg} --connect-timeout 30`, {
    stdio: 'inherit',
  });

  execSync(`cd "${tmpDir}" && tar xzf better-sqlite3-win.tar.gz`);

  // Copy to prebuilds
  const extractedNode = path.join(tmpDir, 'build', 'Release', 'better_sqlite3.node');
  if (!fs.existsSync(extractedNode)) {
    throw new Error(`[prepare-win] Extracted .node file not found at ${extractedNode}`);
  }

  fs.mkdirSync(prebuildDir, { recursive: true });
  fs.copyFileSync(extractedNode, targetFile);
  console.log(`[prepare-win] better-sqlite3 Windows prebuild installed: ${targetFile}`);

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function getElectronAbi(version) {
  // Electron ABI versions (NODE_MODULE_VERSION)
  // See: https://electronjs.org/docs/tutorial/using-native-node-modules
  const abiMap = {
    28: 115, 29: 118, 30: 120, 31: 125, 32: 128, 33: 130,
  };
  const major = parseInt(version.split('.')[0]);
  return abiMap[major] || 130;
}

// --- node-screenshots ---
function prepareNodeScreenshots() {
  const winPkg = 'node-screenshots-win32-x64-msvc';
  const winPkgPath = path.join(ROOT, 'node_modules', winPkg);

  if (!fs.existsSync(winPkgPath)) {
    console.log(`[prepare-win] Installing ${winPkg}...`);
    execSync(`npm install ${winPkg} --force`, { cwd: ROOT, stdio: 'inherit' });
  }

  const nodeFile = path.join(winPkgPath, 'node-screenshots.win32-x64-msvc.node');
  if (fs.existsSync(nodeFile)) {
    console.log(`[prepare-win] node-screenshots Windows binary ready: ${nodeFile}`);
  } else {
    console.warn(`[prepare-win] WARNING: ${nodeFile} not found`);
  }
}

// Main
console.log('[prepare-win] Preparing Windows native modules...');
try {
  prepareBetterSqlite3();
  prepareNodeScreenshots();
  console.log('[prepare-win] Done! Windows native modules prepared.');
} catch (err) {
  console.error(`[prepare-win] FAILED: ${err.message}`);
  process.exit(1);
}
