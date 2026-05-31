const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');

const MODELS = [
  {
    name: 'bergamot enzh model',
    local: 'bergamot-models/enzh/model.enzh.intgemm.alphas.bin',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-zh/cjk_split_vocab_e3B-g-FeQSyTW33DUj2Btw/exported/model.enzh.intgemm.alphas.bin.gz',
    gzipped: true,
  },
  {
    name: 'bergamot enzh lex',
    local: 'bergamot-models/enzh/lex.50.50.enzh.s2t.bin',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-zh/cjk_split_vocab_e3B-g-FeQSyTW33DUj2Btw/exported/lex.50.50.enzh.s2t.bin.gz',
    gzipped: true,
  },
  {
    name: 'bergamot enzh src vocab',
    local: 'bergamot-models/enzh/srcvocab.enzh.spm',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-zh/cjk_split_vocab_e3B-g-FeQSyTW33DUj2Btw/exported/srcvocab.enzh.spm.gz',
    gzipped: true,
  },
  {
    name: 'bergamot enzh trg vocab',
    local: 'bergamot-models/enzh/trgvocab.enzh.spm',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-zh/cjk_split_vocab_e3B-g-FeQSyTW33DUj2Btw/exported/trgvocab.enzh.spm.gz',
    gzipped: true,
  },
  {
    name: 'bergamot zhen model',
    local: 'bergamot-models/zhen/model.zhen.intgemm.alphas.bin',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/zh-en/cjk_icu_base_LQeOIbF7Sbq3XA8lsRPotw/exported/model.zhen.intgemm.alphas.bin.gz',
    gzipped: true,
  },
  {
    name: 'bergamot zhen lex',
    local: 'bergamot-models/zhen/lex.50.50.zhen.s2t.bin',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/zh-en/cjk_icu_base_LQeOIbF7Sbq3XA8lsRPotw/exported/lex.50.50.zhen.s2t.bin.gz',
    gzipped: true,
  },
  {
    name: 'bergamot zhen vocab',
    local: 'bergamot-models/zhen/vocab.zhen.spm',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/zh-en/cjk_icu_base_LQeOIbF7Sbq3XA8lsRPotw/exported/vocab.zhen.spm.gz',
    gzipped: true,
  },
  {
    name: 'paddle OCR detection model',
    local: 'paddle-models/PP-OCRv5_mobile_det_infer.ort',
    url: 'https://media.githubusercontent.com/media/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main/detection/PP-OCRv5_mobile_det_infer.ort',
    gzipped: false,
  },
  {
    name: 'paddle OCR recognition model',
    local: 'paddle-models/en_PP-OCRv5_mobile_rec_infer.ort',
    url: 'https://media.githubusercontent.com/media/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main/recognition/multi/en/v5/en_PP-OCRv5_mobile_rec_infer.ort',
    gzipped: false,
  },
  {
    name: 'paddle OCR dictionary',
    local: 'paddle-models/ppocrv5_en_dict.txt',
    url: 'https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main/recognition/multi/en/v5/ppocrv5_en_dict.txt',
    gzipped: false,
  },
  {
    name: 'tessdata eng',
    local: 'tessdata/eng.traineddata',
    url: 'https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata',
    gzipped: false,
  },
  {
    name: 'tessdata chi_sim',
    local: 'tessdata/chi_sim.traineddata',
    url: 'https://github.com/tesseract-ocr/tessdata/raw/main/chi_sim.traineddata',
    gzipped: false,
  },
];

function downloadFile(url, destPath, isGzipped) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(destPath);
    fs.mkdirSync(dir, { recursive: true });

    const fileStream = fs.createWriteStream(destPath);
    const protocol = url.startsWith('https') ? https : http;

    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        fileStream.close();
        fs.unlinkSync(destPath);
        return downloadFile(response.headers.location, destPath, isGzipped).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        fileStream.close();
        fs.unlinkSync(destPath);
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        return;
      }

      const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
      let downloadedBytes = 0;
      let lastLog = 0;

      if (isGzipped) {
        const gunzip = zlib.createGunzip();
        response.pipe(gunzip).pipe(fileStream);
        gunzip.on('error', (err) => {
          fileStream.close();
          fs.unlinkSync(destPath);
          reject(err);
        });
      } else {
        response.pipe(fileStream);
      }

      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        const now = Date.now();
        if (totalBytes && now - lastLog > 5000) {
          const pct = ((downloadedBytes / totalBytes) * 100).toFixed(1);
          process.stdout.write(`  ${pct}% (${(downloadedBytes / 1024 / 1024).toFixed(1)}MB / ${(totalBytes / 1024 / 1024).toFixed(1)}MB)\n`);
          lastLog = now;
        }
      });

      fileStream.on('finish', () => {
        fileStream.close();
        const sizeMB = (fs.statSync(destPath).size / 1024 / 1024).toFixed(1);
        process.stdout.write(`  Done (${sizeMB}MB)\n`);
        resolve();
      });

      fileStream.on('error', (err) => {
        fileStream.close();
        fs.unlinkSync(destPath);
        reject(err);
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('Downloading model files for Translation Overlay\n');

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const model of MODELS) {
    const destPath = path.join(ROOT, model.local);

    if (fs.existsSync(destPath)) {
      const sizeMB = (fs.statSync(destPath).size / 1024 / 1024).toFixed(1);
      console.log(`[${++skipped + downloaded}/${MODELS.length}] ${model.name}`);
      console.log(`  Already exists (${sizeMB}MB), skipping`);
      skipped++;
      continue;
    }

    console.log(`[${++skipped + downloaded}/${MODELS.length}] ${model.name}`);
    console.log(`  Downloading: ${model.url}`);

    try {
      await downloadFile(model.url, destPath, model.gzipped);
      downloaded++;
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      failed++;
    }
    console.log('');
  }

  console.log('---');
  console.log(`Total: ${MODELS.length} | Downloaded: ${downloaded} | Skipped: ${skipped} | Failed: ${failed}`);

  if (failed > 0) {
    console.warn('\nSome models failed to download. The app will attempt runtime fallback where available.');
    process.exit(1);
  }

  if (downloaded > 0 || skipped === MODELS.length) {
    console.log('\nAll model files ready.');
  }
}

main();
