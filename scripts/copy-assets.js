// Cross-platform copy assets script (works on Windows and Linux/macOS)
const fs = require('fs');
const path = require('path');

const dirs = [
  'dist/renderer/overlay',
  'dist/renderer/settings'
];

const copies = [
  ['src/renderer/overlay/index.html', 'dist/renderer/overlay/index.html'],
  ['src/renderer/overlay/overlay.css', 'dist/renderer/overlay/overlay.css'],
  ['src/renderer/settings/index.html', 'dist/renderer/settings/index.html'],
  ['src/renderer/settings/settings.css', 'dist/renderer/settings/settings.css'],
  ['src/main/services/tesseract-worker-wrapper.js', 'dist/main/services/tesseract-worker-wrapper.js'],
];

// Create directories
for (const dir of dirs) {
  fs.mkdirSync(dir, { recursive: true });
}

// Copy files
for (const [src, dest] of copies) {
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  } else {
    console.warn(`Warning: ${src} not found, skipping`);
  }
}

console.log('Assets copied successfully');
