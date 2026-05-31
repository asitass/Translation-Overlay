import { describe, it, expect } from 'vitest';
import type {
  AppConfig,
  TranslationFrame,
  TranslationResult,
  OcrResult,
  TranslateOptions,
  MonitorInfo,
} from '../../src/shared/types';

describe('types: AppConfig structure', () => {
  it('should accept a valid AppConfig object', () => {
    const config: AppConfig = {
      capture: { intervalIdle: 500, intervalActive: 200 },
      ocr: {
        languages: ['eng', 'chi_sim'],
        confidenceThreshold: 60,
        downscale: 0.5,
      },
      translation: {
        primary: 'google',
        fallback: 'ollama',
        sourceLang: 'auto',
        targetLang: 'zh-CN',
        ollama: { baseUrl: 'http://localhost:11434', model: 'qwen2.5:3b' },
      },
      overlay: { fontSize: 14, backgroundOpacity: 0.75 },
      cache: { dbPath: 'translation_cache.db', maxAgeHours: 168 },
    };
    expect(config.capture.intervalIdle).toBe(500);
    expect(config.ocr.languages).toContain('eng');
    expect(config.translation.primary).toBe('google');
  });

  it('should accept TranslationFrame', () => {
    const frame: TranslationFrame = {
      results: [
        { bbox: [100, 200, 300, 40], original: 'Hello', translated: '你好' },
      ],
      timestamp: Date.now(),
      processingTime: 150,
    };
    expect(frame.results).toHaveLength(1);
    expect(frame.results[0].bbox).toEqual([100, 200, 300, 40]);
  });

  it('should accept OcrResult', () => {
    const result: OcrResult = {
      text: 'test',
      bbox: [10, 20, 100, 30],
      confidence: 95,
    };
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should accept TranslateOptions', () => {
    const opts: TranslateOptions = {
      sourceLang: 'auto',
      targetLang: 'zh-CN',
    };
    expect(opts.sourceLang).toBe('auto');
  });

  it('should accept MonitorInfo', () => {
    const info: MonitorInfo = {
      id: 0,
      width: 1920,
      height: 1080,
      scaleFactor: 1.0,
    };
    expect(info.width).toBe(1920);
  });
});
