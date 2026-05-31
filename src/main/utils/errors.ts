/**
 * Unified error type hierarchy for the Translation Pipeline.
 * Provides structured error handling with context-specific error classes.
 *
 * Usage:
 *   throw new OcrError('PaddleOCR failed', { engine: 'paddle' });
 *   catch (err) { if (err instanceof PipelineError) { ... } }
 */

/** Base error class for all pipeline-related errors */
export class PipelineError extends Error {
  public readonly context: Record<string, unknown>;
  public readonly timestamp: number;

  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'PipelineError';
    this.context = context;
    this.timestamp = Date.now();
  }
}

/** OCR engine errors */
export class OcrError extends PipelineError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, { ...context, component: 'ocr' });
    this.name = 'OcrError';
  }
}

/** Translation engine errors */
export class TranslationError extends PipelineError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, { ...context, component: 'translation' });
    this.name = 'TranslationError';
  }
}

/** Cache operation errors */
export class CacheError extends PipelineError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, { ...context, component: 'cache' });
    this.name = 'CacheError';
  }
}

/** Configuration errors */
export class ConfigError extends PipelineError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, { ...context, component: 'config' });
    this.name = 'ConfigError';
  }
}
