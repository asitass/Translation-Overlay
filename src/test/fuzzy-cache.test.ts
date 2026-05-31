import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { FuzzyCache } from '../main/services/fuzzy-cache';
import { TranslationCache } from '../main/services/cache';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('FuzzyCache', () => {
  let db: Database.Database;
  let fuzzyCache: FuzzyCache;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `test-fuzzy-${Date.now()}.db`);
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    fuzzyCache = new FuzzyCache(db);
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch (_) { /* ignore */ }
  });

  it('should extract trigrams and find similar text', () => {
    // Index a long text
    fuzzyCache.indexTranslation('The Bicentennial Capitol Mall State Park is an urban park', 'en', 'zh');

    const match = fuzzyCache.findSimilar('The Bicentennial Capitol Mall State Park is an urban parks', 'en', 'zh', 0.8);
    expect(match).not.toBeNull();
    expect(match!.similarity).toBeGreaterThan(0.8);
  });

  it('should not match completely different text', () => {
    fuzzyCache.indexTranslation('The quick brown fox jumps over the lazy dog today', 'en', 'zh');

    const match = fuzzyCache.findSimilar('Programming in TypeScript is fun and productive', 'en', 'zh', 0.5);
    expect(match).toBeNull();
  });

  it('should match slightly modified text', () => {
    fuzzyCache.indexTranslation('This is a test sentence for fuzzy matching validation', 'en', 'zh');

    const match = fuzzyCache.findSimilar('This is a test sentences for fuzzy matching validations', 'en', 'zh', 0.8);
    expect(match).not.toBeNull();
    expect(match!.similarity).toBeGreaterThan(0.8);
  });

  it('should not match text below minimum length', () => {
    // Short text should not be indexed
    fuzzyCache.indexTranslation('Short', 'en', 'zh');
    fuzzyCache.indexTranslation('Hello World', 'en', 'zh');

    // Should not crash and should return null for short queries
    const match = fuzzyCache.findSimilar('Hello World!', 'en', 'zh', 0.5);
    expect(match).toBeNull();
  });

  it('should handle empty text', () => {
    fuzzyCache.indexTranslation('', 'en', 'zh');

    const match = fuzzyCache.findSimilar('test', 'en', 'zh', 0.5);
    expect(match).toBeNull();
  });
});

describe('TranslationCache with fuzzy matching', () => {
  let cache: TranslationCache;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `test-cache-${Date.now()}.db`);
    cache = new TranslationCache(dbPath);
  });

  afterEach(() => {
    cache.close();
    try { fs.unlinkSync(dbPath); } catch (_) { /* ignore */ }
  });

  it('should return null for fuzzy miss on empty cache', () => {
    const result = cache.getFuzzy('The Bicentennial Capitol Mall State Park', 'en', 'zh');
    expect(result).toBeNull();
  });

  it('should find fuzzy match for long similar text', () => {
    cache.put('The Bicentennial Capitol Mall State Park is an urban', 'en', 'zh', '二百周年国会大厦州立公园');

    // Exact match should work
    const exact = cache.get('The Bicentennial Capitol Mall State Park is an urban', 'en', 'zh');
    expect(exact).toBe('二百周年国会大厦州立公园');

    // Similar long text should find fuzzy match
    const fuzzy = cache.getFuzzy('The Bicentennial Capitol Mall State Park is an urban park', 'en', 'zh', 0.8);
    expect(fuzzy).toBe('二百周年国会大厦州立公园');
  });

  it('should not fuzzy match short text', () => {
    cache.put('Hello World', 'en', 'zh', '你好世界');

    // Short text should not trigger fuzzy matching
    const fuzzy = cache.getFuzzy('Hello World!', 'en', 'zh', 0.5);
    expect(fuzzy).toBeNull();
  });

  it('should find fuzzy match after batch insert', () => {
    cache.putBatch([
      { text: 'The quick brown fox jumps over the lazy dog', sourceLang: 'en', targetLang: 'zh', translation: '敏捷的棕色狐狸跳过了懒狗' },
      { text: 'Hello World this is a longer text for testing', sourceLang: 'en', targetLang: 'zh', translation: '你好世界这是用于测试的较长文本' },
    ]);

    const fuzzy = cache.getFuzzy('The quick brown fox jumps over the lazy dogs', 'en', 'zh', 0.8);
    expect(fuzzy).not.toBeNull();
  });

  it('should respect language pair in fuzzy matching', () => {
    cache.put('This is a long enough text for testing fuzzy match', 'en', 'zh', '这是一个足够长的文本用于测试模糊匹配');

    // Same text but different language pair should not match
    const fuzzy = cache.getFuzzy('This is a long enough text for testing fuzzy match', 'en', 'ja', 0.5);
    expect(fuzzy).toBeNull();
  });
});
