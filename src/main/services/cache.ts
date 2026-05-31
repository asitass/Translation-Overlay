import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { FuzzyCache } from './fuzzy-cache';

interface CacheEntry {
  text: string;
  sourceLang: string;
  targetLang: string;
  translation: string;
}

export class TranslationCache {
  private db: Database.Database;
  private selectStmt: Database.Statement;
  private insertStmt: Database.Statement;
  private deleteStmt: Database.Statement;
  private fuzzyCache: FuzzyCache;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('cache_size = 32000');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('temp_store = MEMORY');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        text_hash TEXT NOT NULL,
        source_lang TEXT NOT NULL,
        target_lang TEXT NOT NULL,
        original_text TEXT NOT NULL,
        translated_text TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        PRIMARY KEY (text_hash, source_lang, target_lang)
      )
    `);

    this.db.exec('CREATE INDEX IF NOT EXISTS idx_cache_created_at ON cache(created_at)');
    this.db.pragma('optimize');

    // Pre-compile statements for reuse
    this.selectStmt = this.db.prepare(
      'SELECT translated_text FROM cache WHERE text_hash = ? AND source_lang = ? AND target_lang = ?',
    );
    this.insertStmt = this.db.prepare(
      'INSERT OR REPLACE INTO cache (text_hash, source_lang, target_lang, original_text, translated_text) VALUES (?, ?, ?, ?, ?)',
    );
    this.deleteStmt = this.db.prepare('DELETE FROM cache WHERE created_at < ?');

    // Initialize fuzzy cache using the same database connection
    this.fuzzyCache = new FuzzyCache(this.db);

    console.log(`[cache] Initialized at ${dbPath}`);
  }

  private hash(text: string): string {
    return createHash('sha256').update(text, 'utf-8').digest('hex');
  }

  get(text: string, sourceLang: string, targetLang: string): string | null {
    const h = this.hash(text);
    const row = this.selectStmt.get(h, sourceLang, targetLang) as { translated_text: string } | undefined;
    return row?.translated_text ?? null;
  }

  /**
   * Fuzzy lookup: find similar text in cache using trigram matching.
   * Returns the translated text if a similar-enough match is found.
   */
  getFuzzy(text: string, sourceLang: string, targetLang: string, threshold: number = 0.7): string | null {
    const match = this.fuzzyCache.findSimilar(text, sourceLang, targetLang, threshold);
    if (!match) return null;

    // Look up the actual translation for the matched hash
    const row = this.selectStmt.get(match.textHash, sourceLang, targetLang) as { translated_text: string } | undefined;
    if (!row) return null;

    console.log(`[cache] Fuzzy hit: similarity=${match.similarity.toFixed(2)}, text="${text.substring(0, 30)}" → "${row.translated_text.substring(0, 30)}"`);
    return row.translated_text;
  }

  put(text: string, sourceLang: string, targetLang: string, translation: string): void {
    const h = this.hash(text);
    this.insertStmt.run(h, sourceLang, targetLang, text, translation);
    // Index for fuzzy matching
    this.fuzzyCache.indexTranslation(text, sourceLang, targetLang);
  }

  bulkGet(texts: string[], sourceLang: string, targetLang: string): Record<string, string> {
    if (texts.length === 0) return {};

    const hashes = texts.map(t => ({ hash: this.hash(t), original: t }));
    const placeholders = hashes.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT text_hash, translated_text FROM cache
       WHERE text_hash IN (${placeholders}) AND source_lang = ? AND target_lang = ?`,
    ).all(...hashes.map(h => h.hash), sourceLang, targetLang);

    const hashToOriginal = new Map(hashes.map(h => [h.hash, h.original]));
    const results: Record<string, string> = {};
    for (const row of rows as { text_hash: string; translated_text: string }[]) {
      const original = hashToOriginal.get(row.text_hash);
      if (original) results[original] = row.translated_text;
    }
    return results;
  }

  putBatch(entries: CacheEntry[]): void {
    const insertMany = this.db.transaction((entries: CacheEntry[]) => {
      for (const entry of entries) {
        const h = this.hash(entry.text);
        this.insertStmt.run(h, entry.sourceLang, entry.targetLang, entry.text, entry.translation);
        // Index for fuzzy matching (inside transaction for performance)
        this.fuzzyCache.indexTranslation(entry.text, entry.sourceLang, entry.targetLang);
      }
    });
    insertMany(entries);
  }

  cleanup(maxAgeHours: number): number {
    const cutoff = Math.floor(Date.now() / 1000) - maxAgeHours * 3600;
    const result = this.deleteStmt.run(cutoff);
    console.log(`[cache] Cleaned up ${result.changes} expired entries`);
    return result.changes;
  }

  close(): void {
    this.db.close();
    console.log('[cache] Closed');
  }
}
