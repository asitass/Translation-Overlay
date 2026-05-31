/**
 * Tesseract OCR Engine — wraps tesseract.js WASM.
 *
 * This is the existing OCR implementation extracted into the OcrEngine interface.
 * It remains the fallback engine when no faster alternative is available.
 */
import * as Tesseract from 'tesseract.js';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import type { OcrResult, OcrPreprocessingConfig } from '../../../shared/types';
import { DEFAULTS } from '../../../shared/constants';
import { preprocessForOCR, getPreprocessScale } from '../../utils/image-preprocessing';
import type { OcrEngine } from './types';

// Simple image downscale using Canvas (available in Electron)
function downscalePng(pngBuffer: Buffer, scale: number): Promise<{ data: Buffer; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    try {
      const { nativeImage } = require('electron');
      const img = nativeImage.createFromBuffer(pngBuffer);
      const origSize = img.getSize();
      const newWidth = Math.round(origSize.width * scale);
      const newHeight = Math.round(origSize.height * scale);
      console.log(`[ocr-tesseract] Downscaling ${origSize.width}x${origSize.height} → ${newWidth}x${newHeight}`);
      const resized = img.resize({ width: newWidth, height: newHeight });
      const resizedPng = resized.toPNG();
      resolve({ data: resizedPng, width: newWidth, height: newHeight });
    } catch (err) {
      reject(err);
    }
  });
}

function getTessdataDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'tessdata');
  }
  return path.join(__dirname, '..', '..', '..', '..', 'tessdata');
}

function resolveTesseractWorkerPath(): string {
  if (app.isPackaged) {
    let wrapperPath = path.join(__dirname, '..', 'tesseract-worker-wrapper.js');
    if (wrapperPath.includes('app.asar')) {
      wrapperPath = wrapperPath.replace('app.asar', 'app.asar.unpacked');
    }
    return wrapperPath;
  }
  try {
    const tesseractPkgJsonPath = require.resolve('tesseract.js/package.json');
    const tesseractDir = path.dirname(tesseractPkgJsonPath);
    return path.join(tesseractDir, 'src', 'worker-script', 'node', 'index.js');
  } catch {
    return path.join(
      __dirname, '..', '..', '..', '..', 'node_modules',
      'tesseract.js', 'src', 'worker-script', 'node', 'index.js',
    );
  }
}

export interface TesseractEngineConfig {
  languages?: string[];
  confidenceThreshold?: number;
  downscale?: number;
  preprocessing?: OcrPreprocessingConfig;
}

export class TesseractEngine implements OcrEngine {
  readonly name = 'tesseract';
  private worker: Tesseract.Worker | null = null;
  private languages: string[];
  private confidenceThreshold: number;
  private downscale: number;
  private preprocessing: OcrPreprocessingConfig;

  constructor(config?: TesseractEngineConfig) {
    this.languages = config?.languages ?? [...DEFAULTS.OCR_LANGUAGES];
    this.confidenceThreshold = config?.confidenceThreshold ?? DEFAULTS.OCR_CONFIDENCE_THRESHOLD;
    this.downscale = config?.downscale ?? DEFAULTS.OCR_DOWNSCALE;
    this.preprocessing = config?.preprocessing ?? {
      enabled: DEFAULTS.OCR_PREPROCESSING_ENABLED,
      upscale: DEFAULTS.OCR_PREPROCESSING_UPSCALE,
      grayscale: DEFAULTS.OCR_PREPROCESSING_GRAYSCALE,
      normalize: DEFAULTS.OCR_PREPROCESSING_NORMALIZE,
    };
  }

  async initialize(): Promise<void> {
    const langPath = getTessdataDir();
    const langExists = fs.existsSync(langPath);
    console.log(`[ocr-tesseract] Initializing with languages: ${this.languages.join('+')}`);
    console.log(`[ocr-tesseract] langPath: ${langPath}, exists: ${langExists}`);

    if (langExists) {
      const files = fs.readdirSync(langPath);
      console.log(`[ocr-tesseract] tessdata files: ${files.join(', ')}`);
    }

    const workerPath = resolveTesseractWorkerPath();
    console.log(`[ocr-tesseract] workerPath: ${workerPath}, exists: ${fs.existsSync(workerPath)}`);

    const localOptions: Partial<Tesseract.WorkerOptions> = {
      gzip: false,
      workerPath,
    };
    if (langExists) {
      localOptions.langPath = langPath;
    }

    try {
      console.log(`[ocr-tesseract] Creating worker with local langPath: ${langPath || '(CDN)'}`);
      this.worker = await Promise.race([
        Tesseract.createWorker(this.languages, Tesseract.OEM.DEFAULT, localOptions as Tesseract.WorkerOptions),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Worker initialization timeout (15s)')), 15_000)
        ),
      ]);
      console.log('[ocr-tesseract] Worker ready');
    } catch (initErr) {
      console.warn(`[ocr-tesseract] Local init failed: ${initErr}`);
      console.log('[ocr-tesseract] Retrying with CDN fallback...');
      this.worker = await Tesseract.createWorker(this.languages, Tesseract.OEM.DEFAULT);
      console.log('[ocr-tesseract] Worker ready (CDN mode)');
    }

    await this.worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
      preserve_interword_spaces: '1',
      user_defined_dpi: '96',
    });

    console.log(`[ocr-tesseract] Ready (PSM=SPARSE_TEXT, downscale=${this.downscale})`);
  }

  async recognize(imageBuffer: Buffer): Promise<OcrResult[]> {
    if (!this.worker) {
      throw new Error('[ocr-tesseract] Worker not initialized. Call initialize() first.');
    }

    console.log(`[ocr-tesseract] Starting recognition on ${imageBuffer.length} bytes`);

    // Image preprocessing + optional downscale for Tesseract speed
    let ocrBuffer: Buffer;
    let scaleUp: number;

    if (this.preprocessing.enabled) {
      const tPrep = Date.now();
      const processed = await preprocessForOCR(imageBuffer, this.preprocessing);
      const preprocessScale = getPreprocessScale(this.preprocessing);

      if (this.downscale < 1.0) {
        const scaled = await downscalePng(processed, this.downscale);
        ocrBuffer = scaled.data;
        scaleUp = 1 / (preprocessScale * this.downscale);
        console.log(`[ocr-tesseract] Preprocessing took ${Date.now() - tPrep}ms, then downscaled to ${scaled.width}x${scaled.height}`);
      } else {
        ocrBuffer = processed;
        scaleUp = 1 / preprocessScale;
        console.log(`[ocr-tesseract] Preprocessing took ${Date.now() - tPrep}ms`);
      }
    } else if (this.downscale < 1.0) {
      const scaled = await downscalePng(imageBuffer, this.downscale);
      ocrBuffer = scaled.data;
      scaleUp = 1 / this.downscale;
      console.log(`[ocr-tesseract] Downscaled to ${scaled.width}x${scaled.height}, ${ocrBuffer.length} bytes`);
    } else {
      ocrBuffer = imageBuffer;
      scaleUp = 1;
    }

    const t0 = Date.now();
    const result = await this.worker.recognize(ocrBuffer);
    const data = result.data;

    const lines = data.lines;
    console.log(`[ocr-tesseract] Recognition took ${Date.now() - t0}ms, found ${lines.length} lines (${data.words.length} words)`);

    const results: OcrResult[] = [];

    for (const line of lines) {
      const text = line.text.trim();
      const confidence = line.confidence;

      if (text) {
        console.log(`[ocr-tesseract] Line: "${text.substring(0, 40)}" confidence=${confidence.toFixed(1)} (threshold=${this.confidenceThreshold})`);
      }

      if (!text || confidence < this.confidenceThreshold) continue;

      const cleanedText = text.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '');
      if (cleanedText.length < 3) continue;

      const { x0, y0, x1, y1 } = line.bbox;
      const ox = Math.round(x0 * scaleUp);
      const oy = Math.round(y0 * scaleUp);
      const ow = Math.round((x1 - x0) * scaleUp);
      const oh = Math.round((y1 - y0) * scaleUp);

      results.push({
        text,
        bbox: [ox, oy, ow, oh],
        confidence,
      });
    }

    console.log(`[ocr-tesseract] Found ${results.length} text lines after filtering`);
    return results;
  }

  async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      console.log('[ocr-tesseract] Worker terminated');
    }
  }
}
