import type { OcrResult } from '../../../shared/types';

/**
 * Common interface for all OCR engine implementations.
 * Each engine wraps a specific OCR library and produces standardized OcrResult[].
 */
export interface OcrEngine {
  /** Engine name for logging and diagnostics */
  readonly name: string;

  /**
   * Initialize the engine (load models, create workers, etc.).
   * Must be called before recognize().
   */
  initialize(): Promise<void>;

  /**
   * Perform OCR on an image buffer (PNG format from screen capture).
   * Returns recognized text lines with bounding boxes and confidence scores.
   *
   * @param imageBuffer - PNG image buffer from screen capture
   * @returns Array of OCR results with text, bbox [x, y, w, h], and confidence
   */
  recognize(imageBuffer: Buffer): Promise<OcrResult[]>;

  /**
   * Release all resources (workers, models, etc.).
   */
  terminate(): Promise<void>;
}
