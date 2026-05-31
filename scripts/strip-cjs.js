// Cross-platform strip CommonJS artifacts from renderer JS files
const fs = require('fs');
const path = require('path');

const files = [
  'dist/renderer/overlay/overlay.js',
  'dist/renderer/settings/settings.js'
];

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.warn(`Warning: ${file} not found, skipping`);
    continue;
  }

  let content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');

  const filtered = lines.filter((line, index) => {
    if (index > 1) return true;
    return !line.includes('"use strict"') && !line.includes('Object.defineProperty');
  });

  fs.writeFileSync(file, filtered.join('\n'));
  console.log(`Stripped CJS artifacts from ${file}`);
}

console.log('CJS stripping complete');
