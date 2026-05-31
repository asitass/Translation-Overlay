/**
 * OCR Service — engine selector with automatic fallback.
 *
 * Selects the best available OCR engine based on config and platform:
 * 1. 'paddle' — PaddleOCR via ONNX Runtime (~190ms, highest accuracy)
 * 2. 'tesseract' — Tesseract.js WASM (5-6s on Windows, reliable fallback)
 * 3. 'auto' — Try paddle first, fall back to tesseract
 *
 * The engine abstraction is defined in ocr-engines/types.ts.
 * All engines produce standardized OcrResult[] which are then grouped
 * into TextBlock[] by the shared groupOcrLines() utility.
 */
import { OcrResult, TextBlock, OcrPreprocessingConfig, OcrGroupingConfig, OcrEngineType } from '../../shared/types';
import { DEFAULTS } from '../../shared/constants';
import { groupOcrLines } from '../utils/text-grouping';
import type { OcrEngine } from './ocr-engines/types';
import { TesseractEngine } from './ocr-engines/tesseract-engine';
import { PaddleEngine } from './ocr-engines/paddle-engine';

export class OcrService {
  private engine: OcrEngine | null = null;
  private engineType: OcrEngineType;
  private languages: string[];
  private confidenceThreshold: number;
  private downscale: number;
  private preprocessing: OcrPreprocessingConfig;
  private grouping: OcrGroupingConfig;

  constructor(
    languages: string[] = [...DEFAULTS.OCR_LANGUAGES],
    confidenceThreshold: number = DEFAULTS.OCR_CONFIDENCE_THRESHOLD,
    downscale: number = DEFAULTS.OCR_DOWNSCALE,
    preprocessing?: OcrPreprocessingConfig,
    grouping?: OcrGroupingConfig,
    engineType: OcrEngineType = 'auto',
  ) {
    this.languages = languages;
    this.confidenceThreshold = confidenceThreshold;
    this.downscale = downscale;
    this.engineType = engineType;
    this.preprocessing = preprocessing ?? {
      enabled: DEFAULTS.OCR_PREPROCESSING_ENABLED,
      upscale: DEFAULTS.OCR_PREPROCESSING_UPSCALE,
      grayscale: DEFAULTS.OCR_PREPROCESSING_GRAYSCALE,
      normalize: DEFAULTS.OCR_PREPROCESSING_NORMALIZE,
    };
    this.grouping = grouping ?? {
      enabled: DEFAULTS.OCR_GROUPING_ENABLED,
      verticalThresholdRatio: DEFAULTS.OCR_GROUPING_VERTICAL_THRESHOLD_RATIO,
      horizontalThreshold: DEFAULTS.OCR_GROUPING_HORIZONTAL_THRESHOLD,
      requireOverlap: DEFAULTS.OCR_GROUPING_REQUIRE_OVERLAP,
      paragraphGapRatio: DEFAULTS.OCR_GROUPING_PARAGRAPH_GAP_RATIO,
      detectColumns: DEFAULTS.OCR_GROUPING_DETECT_COLUMNS,
    };
  }

  /**
   * Initialize the OCR engine with automatic fallback.
   */
  async initialize(): Promise<void> {
    if (this.engineType === 'auto') {
      await this.initializeWithFallback();
    } else {
      await this.initializeSpecificEngine(this.engineType);
    }
  }

  /**
   * Try engines in priority order, fall back on failure.
   */
  private async initializeWithFallback(): Promise<void> {
    // Priority: paddle → tesseract
    const engines: OcrEngineType[] = ['paddle', 'tesseract'];

    for (const engineType of engines) {
      try {
        await this.initializeSpecificEngine(engineType);
        return; // Success
      } catch (err) {
        console.warn(`[ocr] Engine '${engineType}' failed to initialize: ${err}`);
        console.log(`[ocr] Trying next engine...`);
      }
    }

    throw new Error('[ocr] All OCR engines failed to initialize');
  }

  private async initializeSpecificEngine(type: OcrEngineType): Promise<void> {
    console.log(`[ocr] Initializing engine: ${type}`);

    switch (type) {
      case 'paddle':
        this.engine = new PaddleEngine({
          confidenceThreshold: this.confidenceThreshold / 100,
          minTextLength: 3,
          // Detect Chinese support from language config
          language: this.languages.includes('chi_sim') ? 'ch' : 'en',
          downscale: this.downscale,
        });
        break;

      case 'tesseract':
        this.engine = new TesseractEngine({
          languages: this.languages,
          confidenceThreshold: this.confidenceThreshold,
          downscale: this.downscale,
          preprocessing: this.preprocessing,
        });
        break;

      default:
        throw new Error(`[ocr] Unknown engine type: ${type}`);
    }

    await this.engine.initialize();
    this.engineType = type;
    console.log(`[ocr] Active engine: ${this.engine.name}`);
  }

  /**
   * Get the name of the currently active engine.
   */
  getEngineName(): string {
    return this.engine?.name ?? 'none';
  }

  /**
   * Perform OCR on an image buffer.
   */
  async recognize(imageBuffer: Buffer): Promise<OcrResult[]> {
    if (!this.engine) {
      throw new Error('[ocr] Engine not initialized. Call initialize() first.');
    }
    return this.engine.recognize(imageBuffer);
  }

  /**
   * Perform OCR and group results into TextBlocks for context-aware translation.
   */
  async recognizeGrouped(imageBuffer: Buffer): Promise<TextBlock[]> {
    const lines = await this.recognize(imageBuffer);
    return groupOcrLines(lines, this.grouping);
  }

  /**
   * Terminate the engine and release resources.
   */
  async terminate(): Promise<void> {
    if (this.engine) {
      await this.engine.terminate();
      this.engine = null;
      console.log('[ocr] Engine terminated');
    }
  }
}
