/** Information about a display monitor */
export interface MonitorInfo {
  id: number;
  width: number;
  height: number;
  scaleFactor: number;
}

/** Single OCR recognition result with bounding box */
export interface OcrResult {
  text: string;
  bbox: [number, number, number, number];
  confidence: number;
}

/** A group of OCR lines that form a coherent text block */
export interface TextBlock {
  lines: OcrResult[];
  text: string;
  bbox: [number, number, number, number];
}

/** OCR image preprocessing configuration */
export interface OcrPreprocessingConfig {
  enabled: boolean;
  upscale: number;
  grayscale: boolean;
  normalize: boolean;
}

/** OCR text line grouping configuration */
export interface OcrGroupingConfig {
  enabled: boolean;
  verticalThresholdRatio: number;
  horizontalThreshold: number;
  requireOverlap: boolean;
  paragraphGapRatio: number;
  detectColumns: boolean;
}

/** Translation result for a single text */
export interface TranslationResult {
  original: string;
  translated: string;
  sourceLang: string;
  targetLang: string;
  engine: string;
  cached: boolean;
  qualityScore?: number;
}

/** Options for a translation request */
export interface TranslateOptions {
  sourceLang: string;
  targetLang: string;
  engine?: string;
}

/** A single translated item with position info */
export interface TranslationItem {
  bbox: [number, number, number, number];
  original: string;
  translated: string;
  confidence?: number;
}

/** Overlay display mode */
export type OverlayDisplayMode = 'sideBySide' | 'hover';

/** A frame of translation results sent to the renderer */
export interface TranslationFrame {
  results: TranslationItem[];
  timestamp: number;
  processingTime: number;
  locked?: boolean;
}

/** OCR engine selection */
export type OcrEngineType = 'auto' | 'paddle' | 'tesseract';

/** Lock mode for pipeline behavior when content is stable */
export type LockMode = 'document' | 'dynamic';

/** Pipeline status */
export type PipelineStatus = 'idle' | 'running' | 'stopped' | 'error';

/** Bergamot offline translator status */
export type BergamotStatus = 'uninitialized' | 'loading' | 'ready' | 'error';

/** Translation engine configuration */
export interface TranslationConfig {
  primary: string;
  fallback: string;
  sourceLang: string;
  targetLang: string;
  google?: { proxyUrl?: string };
  ollama?: { baseUrl: string; model: string };
  deepl?: { apiKey: string; freeApi?: boolean };
  bergamot?: { modelDir?: string };
}

/** Full application configuration */
export interface AppConfig {
  capture: {
    intervalIdle: number;
    intervalActive: number;
  };
  ocr: {
    engine: OcrEngineType;
    languages: string[];
    confidenceThreshold: number;
    downscale: number;
    preprocessing: OcrPreprocessingConfig;
    grouping: OcrGroupingConfig;
  };
  translation: TranslationConfig;
  overlay: {
    fontSize: number;
    backgroundOpacity: number;
    displayMode: OverlayDisplayMode;
  };
  cache: {
    dbPath: string;
    maxAgeHours: number;
  };
  pipeline: {
    lockMode: LockMode;
    fuzzyThreshold: number;
  };
}
