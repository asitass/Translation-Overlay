/**
 * Tesseract.js Worker Wrapper for Electron packaged mode.
 *
 * Problem: In Electron Worker threads, `is-electron` detects process.versions.electron
 * and returns true. Tesseract.js then sets env='electron' instead of env='node',
 * treating langPath as a URL and using node-fetch (which rejects filesystem paths).
 *
 * Fix: Delete process.versions.electron before loading the real worker script,
 * so tesseract.js correctly detects the Node.js environment and reads
 * .traineddata files from the local filesystem instead of trying to fetch them.
 */
delete process.versions.electron;
require('../../../node_modules/tesseract.js/src/worker-script/node/index.js');
