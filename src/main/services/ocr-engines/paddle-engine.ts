/**
 * PaddleOCR Engine — uses ppu-paddle-ocr with ONNX Runtime.
 *
 * Expected performance: ~190ms per frame (vs 5-6s with Tesseract WASM).
 * Supports 100+ languages including English and Chinese via PP-OCRv5 models.
 * Accepts ArrayBuffer directly (no temp file needed).
 */
import type { OcrResult } from '../../../shared/types';
import { DEFAULTS } from '../../../shared/constants';
import type { OcrEngine } from './types';

// Dynamic import — ppu-paddle-ocr is an optional dependency that may not be installed
type PaddleOcrServiceType = import('ppu-paddle-ocr').PaddleOcrService;
type PaddleOcrResult = {
  text: string;
  lines: Array<Array<{
    text: string;
    box: { x: number; y: number; width: number; height: number };
    confidence: number;
  }>>;
  confidence: number;
};

export interface PaddleEngineConfig {
  /** Minimum confidence threshold (0-1) to filter low-quality results */
  confidenceThreshold?: number;
  /** Minimum text length after cleaning noise characters */
  minTextLength?: number;
  /** Recognition model language: 'en' (default) or 'ch' for Chinese */
  language?: string;
  /** Downscale factor before OCR (0-1). Reduces canvas processing time. Default: 0.65 */
  downscale?: number;
}

export class PaddleEngine implements OcrEngine {
  readonly name = 'paddle';
  private service: PaddleOcrServiceType | null = null;
  private confidenceThreshold: number;
  private minTextLength: number;
  private language: string;
  private downscale: number;

  constructor(config?: PaddleEngineConfig) {
    this.confidenceThreshold = config?.confidenceThreshold ?? (DEFAULTS.OCR_CONFIDENCE_THRESHOLD / 100);
    this.minTextLength = config?.minTextLength ?? 3;
    this.language = config?.language ?? 'en';
    this.downscale = config?.downscale ?? DEFAULTS.OCR_DOWNSCALE;
  }

  async initialize(): Promise<void> {
    console.log(`[ocr-paddle] Initializing PaddleOCR (language: ${this.language})`);

    try {
      // ppu-paddle-ocr is ESM-only. In CJS context, dynamic import() gets compiled
      // to require() by TypeScript. Use Function constructor to force a true ESM import.
      const paddleModule = await (async () => {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const dynamicImport = new Function('modulePath', 'return import(modulePath)');
        return dynamicImport('ppu-paddle-ocr');
      })();
      const PaddleOcrService = paddleModule.PaddleOcrService as typeof import('ppu-paddle-ocr').PaddleOcrService;
      this.service = new PaddleOcrService(this.buildOptions()) as unknown as PaddleOcrServiceType;
      await this.service.initialize();
      console.log('[ocr-paddle] PaddleOCR initialized successfully');
    } catch (err) {
      console.error(`[ocr-paddle] Failed to initialize: ${err}`);
      throw err;
    }
  }

  /**
   * Resolve local model path. In packaged app, resources are in extraResources.
   * In dev, they're in the project root.
   */
  private resolveModelPath(filename: string): string {
    const path = require('path') as typeof import('path');
    // __dirname is dist/main/services/ocr-engines/
    // Packaged: resources/paddle-models/filename
    // Dev: project-root/paddle-models/filename
    const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');
    const devPath = path.join(projectRoot, 'paddle-models', filename);
    const fs = require('fs') as typeof import('fs');
    if (fs.existsSync(devPath)) {
      return devPath;
    }
    // Packaged app: extraResources puts paddle-models alongside app.asar
    const packagedPath = path.join(process.resourcesPath, 'paddle-models', filename);
    if (fs.existsSync(packagedPath)) {
      return packagedPath;
    }
    // Fallback: return dev path (will trigger download if not found)
    console.log(`[ocr-paddle] Model not found locally: ${filename}, tried ${devPath} and ${packagedPath}`);
    return devPath;
  }

  private buildOptions(): Record<string, unknown> {
    // Use canvas-native engine to avoid OpenCV.js dependency overhead.
    // For screen OCR, canvas-native is sufficient and faster to load.
    // Use local model files to avoid runtime download timeout.
    const detectionModel = this.resolveModelPath('PP-OCRv5_mobile_det_infer.ort');
    const recognitionModel = this.resolveModelPath('en_PP-OCRv5_mobile_rec_infer.ort');
    const dictFile = this.resolveModelPath('ppocrv5_en_dict.txt');

    console.log(`[ocr-paddle] Detection model: ${detectionModel}`);
    console.log(`[ocr-paddle] Recognition model: ${recognitionModel}`);
    console.log(`[ocr-paddle] Dictionary: ${dictFile}`);

    return {
      model: {
        detection: detectionModel,
        recognition: recognitionModel,
        charactersDictionary: dictFile,
      },
      processing: { engine: 'canvas-native' as const },
      detection: {
        // Increase minimum area threshold to filter small/noisy detections
        minimumAreaThreshold: 100,
        // Increase padding to merge nearby fragments
        paddingVertical: 0.5,
        paddingHorizontal: 0.8,
      },
      recognition: {
        // Use cross-line strategy: batches multiple lines into single inference
        // Fewer inferences = faster overall recognition
        strategy: 'cross-line' as const,
      },
    };
  }

  async recognize(imageBuffer: Buffer): Promise<OcrResult[]> {
    if (!this.service) {
      throw new Error('[ocr-paddle] Service not initialized. Call initialize() first.');
    }

    const t0 = Date.now();
    console.log(`[ocr-paddle] Starting recognition on ${imageBuffer.length} bytes`);

    // Downscale image before OCR to reduce canvas processing time.
    // Bounding box coordinates are scaled back to original dimensions.
    let ocrBuffer: Buffer;
    let scaleUp: number;

    if (this.downscale < 1.0) {
      const downscaled = this.downscaleImage(imageBuffer, this.downscale);
      ocrBuffer = downscaled.data;
      scaleUp = 1 / this.downscale;
      console.log(`[ocr-paddle] Downscaled to ${downscaled.width}x${downscaled.height}, ${ocrBuffer.length} bytes`);
    } else {
      ocrBuffer = imageBuffer;
      scaleUp = 1;
    }

    // Convert Node.js Buffer to ArrayBuffer for ppu-paddle-ocr
    const arrayBuffer = ocrBuffer.buffer.slice(
      ocrBuffer.byteOffset,
      ocrBuffer.byteOffset + ocrBuffer.byteLength,
    ) as ArrayBuffer;

    const result = await this.service.recognize(arrayBuffer) as unknown as PaddleOcrResult;

    const elapsed = Date.now() - t0;
    const totalLines = result.lines.length;
    console.log(`[ocr-paddle] Recognition took ${elapsed}ms, found ${totalLines} lines (avg confidence: ${result.confidence.toFixed(2)})`);

    const ocrResults: OcrResult[] = [];

    for (const lineWords of result.lines) {
      if (!lineWords || lineWords.length === 0) continue;

      // Merge word-level results into a single line result
      const lineText = lineWords.map((w) => w.text).join(' ').trim();
      if (!lineText) continue;

      // Compute line-level confidence as average of word confidences
      const avgConfidence = lineWords.reduce((sum, w) => sum + w.confidence, 0) / lineWords.length;

      // Scale confidence to 0-100 to match Tesseract's scale
      const confidence = avgConfidence * 100;

      if (confidence < this.confidenceThreshold) {
        console.log(`[ocr-paddle] Filtered low-confidence line: "${lineText.substring(0, 40)}" confidence=${confidence.toFixed(1)}`);
        continue;
      }

      // Filter out too-short text (noise)
      const cleanedText = lineText.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '');
      if (cleanedText.length < this.minTextLength) continue;

      // Compute line bounding box from word boxes, scaled back to original image dimensions
      const lineBox = this.computeLineBoundingBox(lineWords, scaleUp);

      ocrResults.push({
        text: lineText,
        bbox: lineBox,
        confidence,
      });

      console.log(`[ocr-paddle] Line: "${lineText.substring(0, 40)}" confidence=${confidence.toFixed(1)} box=[${lineBox.join(',')}]`);
    }

    console.log(`[ocr-paddle] Found ${ocrResults.length} text lines after filtering`);
    return ocrResults;
  }

  /**
   * Compute a bounding box that encloses all word boxes in a line.
   * Scales coordinates back to original image dimensions.
   * Returns [x, y, width, height] matching our OcrResult format.
   */
  private computeLineBoundingBox(
    words: Array<{ box: { x: number; y: number; width: number; height: number } }>,
    scaleUp: number,
  ): [number, number, number, number] {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const word of words) {
      const { x, y, width, height } = word.box;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + width);
      maxY = Math.max(maxY, y + height);
    }

    return [
      Math.round(minX * scaleUp),
      Math.round(minY * scaleUp),
      Math.round((maxX - minX) * scaleUp),
      Math.round((maxY - minY) * scaleUp),
    ];
  }

  /**
   * Downscale image using Electron's nativeImage.
   */
  private downscaleImage(pngBuffer: Buffer, scale: number): { data: Buffer; width: number; height: number } {
    const { nativeImage } = require('electron');
    const img = nativeImage.createFromBuffer(pngBuffer);
    const origSize = img.getSize();
    const newWidth = Math.round(origSize.width * scale);
    const newHeight = Math.round(origSize.height * scale);
    const resized = img.resize({ width: newWidth, height: newHeight });
    return { data: resized.toPNG(), width: newWidth, height: newHeight };
  }

  async terminate(): Promise<void> {
    if (this.service) {
      await this.service.destroy();
      this.service = null;
      console.log('[ocr-paddle] Service destroyed');
    }
  }
}
