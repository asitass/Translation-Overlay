import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TranslationCache } from '../../src/main/services/cache';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';

const TEST_DB = join(__dirname, '__test_cache__.db');

describe('TranslationCache', () => {
  let cache: TranslationCache;

  beforeEach(() => {
    if (existsSync(TEST_DB)) rmSync(TEST_DB);
    cache = new TranslationCache(TEST_DB);
  });

  afterEach(() => {
    cache.close();
    if (existsSync(TEST_DB)) rmSync(TEST_DB);
  });

  it('should return null for missing key', () => {
    expect(cache.get('hello', 'en', 'zh-CN')).toBeNull();
  });

  it('should store and retrieve a translation', () => {
    cache.put('hello', 'en', 'zh-CN', '你好');
    expect(cache.get('hello', 'en', 'zh-CN')).toBe('你好');
  });

  it('should overwrite existing translation', () => {
    cache.put('hello', 'en', 'zh-CN', '你好');
    cache.put('hello', 'en', 'zh-CN', '您好');
    expect(cache.get('hello', 'en', 'zh-CN')).toBe('您好');
  });

  it('should separate entries by language pair', () => {
    cache.put('hello', 'en', 'zh-CN', '你好');
    cache.put('hello', 'en', 'ja', 'こんにちは');
    expect(cache.get('hello', 'en', 'zh-CN')).toBe('你好');
    expect(cache.get('hello', 'en', 'ja')).toBe('こんにちは');
  });

  it('should bulk get cached translations', () => {
    cache.put('hello', 'en', 'zh-CN', '你好');
    cache.put('world', 'en', 'zh-CN', '世界');
    const results = cache.bulkGet(['hello', 'world', 'test'], 'en', 'zh-CN');
    expect(results['hello']).toBe('你好');
    expect(results['world']).toBe('世界');
    expect(results['test']).toBeUndefined();
  });

  it('should clean up expired entries', () => {
    cache.put('old', 'en', 'zh-CN', '旧');
    // Access the internal db to set created_at to past
    const db = (cache as unknown as { db: Database.Database }).db;
    const oldTime = Math.floor(Date.now() / 1000) - 200 * 3600;
    db.prepare('UPDATE cache SET created_at = ? WHERE original_text = ?').run(oldTime, 'old');

    const cleaned = cache.cleanup(168);
    expect(cleaned).toBe(1);
    expect(cache.get('old', 'en', 'zh-CN')).toBeNull();
  });

  it('should return empty object for empty bulkGet', () => {
    const results = cache.bulkGet([], 'en', 'zh-CN');
    expect(results).toEqual({});
  });

  it('should batch put translations in a transaction', () => {
    cache.putBatch([
      { text: 'hello', sourceLang: 'en', targetLang: 'zh-CN', translation: '你好' },
      { text: 'world', sourceLang: 'en', targetLang: 'zh-CN', translation: '世界' },
      { text: 'test', sourceLang: 'en', targetLang: 'zh-CN', translation: '测试' },
    ]);
    expect(cache.get('hello', 'en', 'zh-CN')).toBe('你好');
    expect(cache.get('world', 'en', 'zh-CN')).toBe('世界');
    expect(cache.get('test', 'en', 'zh-CN')).toBe('测试');
  });

  it('should clean up expired entries faster with index', () => {
    // Insert 100 entries
    for (let i = 0; i < 100; i++) {
      cache.put(`text${i}`, 'en', 'zh-CN', `翻译${i}`);
    }
    // Set half of them as expired
    const db = (cache as unknown as { db: Database.Database }).db;
    const oldTime = Math.floor(Date.now() / 1000) - 200 * 3600;
    for (let i = 0; i < 50; i++) {
      db.prepare('UPDATE cache SET created_at = ? WHERE original_text = ?').run(oldTime, `text${i}`);
    }
    const cleaned = cache.cleanup(168);
    expect(cleaned).toBe(50);
  });
});
