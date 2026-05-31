/**
 * OutputTracker manages the set of recently emitted translations.
 * Used to filter overlay feedback: OCR re-detects translated text from the overlay,
 * creating a feedback loop. We skip any OCR text matching a recent output.
 *
 * Uses LRU eviction: when the set exceeds maxSize, oldest entries are removed.
 * Implementation uses a Map for O(1) insertion and O(1) eviction.
 */
export class OutputTracker {
  private entries: Map<string, number> = new Map();
  private readonly maxSize: number;

  constructor(maxSize: number = 150) {
    this.maxSize = maxSize;
  }

  /**
   * Add translated and original text to the tracker.
   */
  add(translated: string, original: string): void {
    const transTrimmed = translated.trim();
    const origTrimmed = original.trim();

    if (transTrimmed) {
      this.entries.set(transTrimmed, Date.now());
    }
    if (origTrimmed) {
      this.entries.set(origTrimmed, Date.now());
    }

    // Evict oldest entries if over limit
    this.evictIfNeeded();
  }

  /**
   * Check if the given text matches a recent output.
   */
  has(text: string): boolean {
    return this.entries.has(text.trim());
  }

  /**
   * Clear all tracked outputs.
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Get current count of tracked entries.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Evict oldest entries if over maxSize.
   * Map maintains insertion order, so the first entry is the oldest.
   */
  private evictIfNeeded(): void {
    // Use a soft limit: evict down to maxSize when we reach maxSize * 1.33
    const softLimit = Math.floor(this.maxSize * 1.33);
    if (this.entries.size <= softLimit) return;

    const toRemove = this.entries.size - this.maxSize;
    let removed = 0;
    for (const key of this.entries.keys()) {
      if (removed >= toRemove) break;
      this.entries.delete(key);
      removed++;
    }
  }
}
