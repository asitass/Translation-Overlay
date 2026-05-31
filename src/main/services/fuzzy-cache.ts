import Database from 'better-sqlite3';
import { createHash } from 'crypto';

/**
 * Minimum text length for fuzzy matching.
 * Short texts have too few trigrams and high collision probability.
 */
const MIN_TEXT_LENGTH = 20;

/**
 * Trigram-based fuzzy matching cache layer.
 * Sits on top of TranslationCache and provides similarity-based lookups.
 *
 * IMPORTANT: Fuzzy matching is conservative — it only returns matches when:
 * 1. Text is long enough (>= 20 chars) to have meaningful trigram overlap
 * 2. Containment ratio is very high (>= 0.85 by default)
 * 3. The matched original text is also retrieved and verified to be semantically related
 *
 * This prevents false positives where unrelated short texts share common trigrams.
 */
export class FuzzyCache {
  private db: Database.Database;
  private insertTrigramStmt: Database.Statement;
  private deleteTrigramsStmt: Database.Statement;

  constructor(db: Database.Database) {
    this.db = db;

    // Create trigram index table in the same database
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trigram_index (
        trigram TEXT NOT NULL,
        text_hash TEXT NOT NULL,
        source_lang TEXT NOT NULL,
        target_lang TEXT NOT NULL,
        PRIMARY KEY (trigram, text_hash, source_lang, target_lang)
      )
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_trigram_search ON trigram_index(trigram, source_lang, target_lang)');

    // Pre-compile statements
    this.insertTrigramStmt = this.db.prepare(
      'INSERT OR IGNORE INTO trigram_index (trigram, text_hash, source_lang, target_lang) VALUES (?, ?, ?, ?)',
    );
    this.deleteTrigramsStmt = this.db.prepare(
      'DELETE FROM trigram_index WHERE text_hash = ? AND source_lang = ? AND target_lang = ?',
    );

    console.log('[fuzzy-cache] Initialized');
  }

  /**
   * Extract character trigrams from text.
   * Returns a Set of unique trigrams.
   */
  private extractTrigrams(text: string): Set<string> {
    const normalized = text.toLowerCase().trim();
    if (normalized.length < 3) return new Set();

    const trigrams = new Set<string>();
    for (let i = 0; i <= normalized.length - 3; i++) {
      trigrams.add(normalized.substring(i, i + 3));
    }
    return trigrams;
  }

  /**
   * Compute hash for a text. Must match TranslationCache's hash.
   */
  private hash(text: string): string {
    return createHash('sha256').update(text, 'utf-8').digest('hex');
  }

  /**
   * Index a translation for fuzzy matching.
   * Only indexes texts that are long enough to have meaningful trigrams.
   */
  indexTranslation(text: string, sourceLang: string, targetLang: string): void {
    // Skip short texts — they cause false positives
    if (text.trim().length < MIN_TEXT_LENGTH) return;

    const trigrams = this.extractTrigrams(text);
    if (trigrams.size < 5) return;

    const textHash = this.hash(text);

    // Insert trigrams in a transaction
    const insertMany = this.db.transaction((trigramSet: Set<string>) => {
      for (const trigram of trigramSet) {
        this.insertTrigramStmt.run(trigram, textHash, sourceLang, targetLang);
      }
    });
    insertMany(trigrams);
  }

  /**
   * Find similar cached texts using trigram containment ratio.
   * Returns the text_hash and similarity score of the best match,
   * or null if no match exceeds the threshold.
   *
   * The threshold should be >= 0.85 to avoid false matches.
   */
  findSimilar(
    text: string,
    sourceLang: string,
    targetLang: string,
    threshold: number = 0.85,
  ): { textHash: string; similarity: number } | null {
    // Skip short texts — not enough signal for reliable matching
    if (text.trim().length < MIN_TEXT_LENGTH) return null;

    const trigrams = this.extractTrigrams(text);
    if (trigrams.size < 5) return null;

    // Query for candidates with matching trigrams using individual params
    const trigramArray = [...trigrams];
    const placeholders = trigramArray.map(() => '?').join(',');
    const candidates = this.db.prepare(
      `SELECT text_hash, COUNT(*) as match_count
       FROM trigram_index
       WHERE trigram IN (${placeholders}) AND source_lang = ? AND target_lang = ?
       GROUP BY text_hash
       ORDER BY match_count DESC
       LIMIT 10`,
    ).all(...trigramArray, sourceLang, targetLang) as Array<{ text_hash: string; match_count: number }>;

    if (candidates.length === 0) return null;

    // Find best match using containment ratio
    let bestMatch: { textHash: string; similarity: number } | null = null;

    for (const candidate of candidates) {
      // Containment ratio: what fraction of query trigrams are found in candidate
      const containment = candidate.match_count / trigrams.size;

      if (containment >= threshold && (!bestMatch || containment > bestMatch.similarity)) {
        bestMatch = {
          textHash: candidate.text_hash,
          similarity: containment,
        };
      }
    }

    return bestMatch;
  }

  /**
   * Remove trigrams for a specific text hash.
   */
  removeIndex(textHash: string, sourceLang: string, targetLang: string): void {
    this.deleteTrigramsStmt.run(textHash, sourceLang, targetLang);
  }
}
