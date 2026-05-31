import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TranslatorService } from '../../src/main/services/translator';
import { TranslationCache } from '../../src/main/services/cache';
import { join } from 'path';
import { rmSync, existsSync } from 'fs';

const TEST_DB = join(__dirname, '__test_translator_cache__.db');

// Mock the named export from @vitalets/google-translate-api
vi.mock('@vitalets/google-translate-api', () => ({
  translate: vi.fn(),
}));

// Mock global fetch to prevent real network calls to Ollama
global.fetch = vi.fn();

import { translate } from '@vitalets/google-translate-api';
const mockTranslate = vi.mocked(translate);
const mockFetch = vi.mocked(fetch);

describe('TranslatorService', () => {
  let service: TranslatorService;
  let cache: TranslationCache;

  beforeEach(() => {
    vi.clearAllMocks();
    if (existsSync(TEST_DB)) rmSync(TEST_DB);
    cache = new TranslationCache(TEST_DB);
    service = new TranslatorService(
      {
        primary: 'google',
        fallback: 'ollama',
        sourceLang: 'auto',
        targetLang: 'zh-CN',
        ollama: { baseUrl: 'http://localhost:11434', model: 'test' },
      },
      cache,
    );
  });

  afterEach(() => {
    cache.close();
    if (existsSync(TEST_DB)) rmSync(TEST_DB);
  });

  it('should detect Chinese text', () => {
    expect(service.detectLanguage('你好世界')).toBe('zh');
  });

  it('should detect English text', () => {
    expect(service.detectLanguage('Hello World')).toBe('en');
  });

  it('should skip translation when source equals target (zh→zh)', async () => {
    const results = await service.translate(
      [{ text: '你好', bbox: [0, 0, 50, 20] }],
      { sourceLang: 'auto', targetLang: 'zh-CN' },
    );
    expect(results).toHaveLength(0);
  });

  it('should skip translation when source equals target (en→en)', async () => {
    const results = await service.translate(
      [{ text: 'Hello', bbox: [0, 0, 50, 20] }],
      { sourceLang: 'auto', targetLang: 'en' },
    );
    expect(results).toHaveLength(0);
  });

  it('should return cached translations without calling API', async () => {
    cache.put('hello', 'en', 'zh-CN', '你好');
    const results = await service.translate(
      [{ text: 'hello', bbox: [0, 0, 50, 20] }],
      { sourceLang: 'auto', targetLang: 'zh-CN' },
    );
    expect(results).toHaveLength(1);
    expect(results[0].translated).toBe('你好');
    expect(results[0].cached).toBe(true);
    expect(mockTranslate).not.toHaveBeenCalled();
  });

  it('should call Google Translate API for uncached text', async () => {
    mockTranslate.mockResolvedValue({
      text: '你好',
      from: { language: { iso: 'en' } },
    } as never);
    const results = await service.translate(
      [{ text: 'hello world', bbox: [0, 0, 100, 20] }],
      { sourceLang: 'auto', targetLang: 'zh-CN' },
    );
    expect(results).toHaveLength(1);
    expect(results[0].translated).toBe('你好');
    expect(results[0].engine).toBe('google');
    expect(results[0].cached).toBe(false);
    expect(mockTranslate).toHaveBeenCalled();
  });

  it('should return original text when all engines fail', async () => {
    mockTranslate.mockRejectedValue(new Error('Network error'));
    // Mock fetch to reject for Ollama fallback
    mockFetch.mockRejectedValue(new Error('Ollama not available'));

    const results = await service.translate(
      [{ text: 'test', bbox: [0, 0, 50, 20] }],
      { sourceLang: 'en', targetLang: 'zh-CN' },
    );
    expect(results).toHaveLength(1);
    expect(results[0].translated).toBe('test');
  });
});
