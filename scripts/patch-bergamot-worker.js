/**
 * Postinstall script: Patch bergamot translator-worker for Electron compatibility
 *
 * Fixes two issues:
 * 1. ESM/CJS conflict: package has "type": "module", but worker uses require().
 *    Fix: Copy .js to .cjs so Node.js treats it as CommonJS.
 *
 * 2. Windows file:// URL bug: GlobalWorkerScope.fetch() uses url.pathname
 *    directly, which on Windows produces '/C:/path' with a leading slash.
 *    readFile() then misinterprets this as a relative path, resulting in
 *    'C:\C:\path' (doubled drive letter).
 *    Fix: Replace readFile(url.pathname) with fileURLToPath(url) or
 *    manual pathname cleanup.
 */
const fs = require('fs');
const path = require('path');

const workerDir = path.join(
  __dirname, '..', 'node_modules', '@mkljczk', 'bergamot-translator', 'worker'
);
const srcFile = path.join(workerDir, 'translator-worker.js');
const dstFile = path.join(workerDir, 'translator-worker.cjs');

try {
  if (!fs.existsSync(srcFile)) {
    console.log('[postinstall] bergamot worker not found (skipping patch)');
    process.exit(0);
  }

  let content = fs.readFileSync(srcFile, 'utf-8');

  // Fix: Replace url.pathname with proper file:// URL to path conversion
  // Original code in GlobalWorkerScope.fetch():
  //   const buffer = await readFile(url.pathname);
  // On Windows, url.pathname for file://C:/Users/... is '/C:/Users/...'
  // which readFile misinterprets, producing 'C:\C:\Users\...'
  const originalFetch = "const buffer = await readFile(url.pathname);";
  const fixedFetch = `const buffer = await readFile(url.pathname.replace(/^\\/([A-Za-z]:)/, '$1'));`;

  if (content.includes(originalFetch)) {
    content = content.replace(originalFetch, fixedFetch);
    console.log('[postinstall] Patched bergamot worker: fixed Windows file:// URL pathname');
  } else {
    console.log('[postinstall] bergamot worker fetch code already patched or different');
  }

  // Write the patched .cjs file
  fs.writeFileSync(dstFile, content, 'utf-8');
  console.log('[postinstall] Patched bergamot worker: created translator-worker.cjs');
} catch (err) {
  console.warn('[postinstall] Failed to patch bergamot worker:', err.message);
}
