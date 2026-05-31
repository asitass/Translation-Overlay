import { createHash } from 'crypto';
import levenshtein from 'fast-levenshtein';
import { DEFAULTS } from '../../shared/constants';

interface TextItem {
  text: string;
  bbox: [number, number, number, number];
}

interface TimeWindowEntry {
  textHash: string;
  timestamp: number;
}

export class ChangeDetector {
  private threshold: number;
  private blockSize: number;
  private prevPositionHashes: Set<string> = new Set();
  private timeWindowEntries: TimeWindowEntry[] = [];
  private timeWindowMs: number;
  private positionGrid: number;

  // Fuzzy matching: stores previous frame's text per grid position
  private prevFrameTexts: Map<string, string> = new Map();
  private fuzzyThreshold: number;
  private fuzzyGridRange: number;
  private minTextLengthForFuzzy: number;

  // Stability tracking for lock mode
  private lastTextSet: Set<string> | null = null;
  private stabilityCounter = 0;

  constructor(
    threshold: number = DEFAULTS.CHANGE_DETECTOR_THRESHOLD,
    blockSize: number = DEFAULTS.CHANGE_DETECTOR_BLOCK_SIZE,
    timeWindowMs: number = DEFAULTS.CHANGE_DETECTOR_TIME_WINDOW_MS,
    positionGrid: number = DEFAULTS.CHANGE_DETECTOR_POSITION_GRID,
    fuzzyThreshold: number = DEFAULTS.FUZZY_MATCH_THRESHOLD,
  ) {
    this.threshold = threshold;
    this.blockSize = blockSize;
    this.timeWindowMs = timeWindowMs;
    this.positionGrid = positionGrid;
    this.fuzzyThreshold = fuzzyThreshold;
    this.fuzzyGridRange = DEFAULTS.FUZZY_SEARCH_GRID_RANGE;
    this.minTextLengthForFuzzy = DEFAULTS.MIN_TEXT_LENGTH_FOR_FUZZY;
  }

  /**
   * Multi-layer hybrid change detection:
   * Layer 0: Dimension check (instant)
   * Layer 1: Exact match via Buffer.compare (~0.1ms for 8MB)
   * Layer 2: Sampled pixel comparison with early termination
   */
  hasSignificantChange(
    current: Uint8Array,
    previous: Uint8Array,
    currentWidth: number,
    previousWidth: number,
    unlockThreshold?: number,
  ): boolean {
    // Layer 0: Dimension check
    if (current.length !== previous.length || currentWidth !== previousWidth) {
      return true;
    }

    // Layer 1: Exact match check (fast path for unchanged frames)
    if (current.byteLength === previous.byteLength) {
      const currBuf = Buffer.from(current.buffer, current.byteOffset, current.byteLength);
      const prevBuf = Buffer.from(previous.buffer, previous.byteOffset, previous.byteLength);
      if (currBuf.equals(prevBuf)) {
        return false;
      }
    }

    // Layer 2: Sampled comparison with early termination
    const effectiveThreshold = unlockThreshold ?? this.threshold;
    const pixelCount = current.length / 4;
    const stride = 4; // Check every 4th pixel (25% sampling)
    let changedPixels = 0;
    const thresholdPixels = pixelCount * effectiveThreshold;
    const rgbThreshold = 30;

    for (let i = 0; i < current.length; i += 4 * stride) {
      const dr = Math.abs(current[i] - previous[i]);
      const dg = Math.abs(current[i + 1] - previous[i + 1]);
      const db = Math.abs(current[i + 2] - previous[i + 2]);
      if (dr > rgbThreshold || dg > rgbThreshold || db > rgbThreshold) {
        changedPixels++;
        // Early termination: already exceeded threshold
        if (changedPixels * stride > thresholdPixels) {
          return true;
        }
      }
    }

    // Scale up sampled count to estimate total changed ratio
    return (changedPixels * stride / pixelCount) > effectiveThreshold;
  }

  /**
   * Normalize text for deduplication: strip punctuation and whitespace noise.
   * Handles OCR artifacts like "Settings" vs "Settings." vs "  Settings  "
   */
  private normalizeText(text: string): string {
    return text
      .replace(/[^\w\u4e00-\u9fff]/g, '')
      .trim()
      .toLowerCase();
  }

  /**
   * Compute Levenshtein similarity ratio between two strings.
   * Returns 0.0 (completely different) to 1.0 (identical).
   */
  private levenshteinSimilarity(a: string, b: string): number {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1.0;
    const dist = levenshtein.get(a, b);
    return 1 - dist / maxLen;
  }

  /**
   * Check if two normalized texts are similar enough to be considered the same.
   * Uses Levenshtein similarity first, then falls back to prefix matching
   * for OCR truncation detection (e.g., "helloworld" starts with "hellowor").
   */
  private isTextSimilar(a: string, b: string): boolean {
    // Standard Levenshtein check
    const similarity = this.levenshteinSimilarity(a, b);
    if (similarity >= this.fuzzyThreshold) return true;

    // Truncation check: if shorter string is a prefix of longer one,
    // and the shorter string is at least 4 chars (avoid false positives on short texts)
    const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
    if (shorter.length >= this.minTextLengthForFuzzy && longer.startsWith(shorter)) {
      return true;
    }

    return false;
  }

  /**
   * Search previous frame's texts in a neighborhood of the given grid position.
   * Returns true if any candidate text is similar enough (via Levenshtein or prefix).
   * For short texts (below minTextLengthForFuzzy), falls back to exact match.
   */
  private isFuzzyMatchInPrevFrame(normalized: string, gridX: number, gridY: number): boolean {
    // Short text: exact match via position hash
    if (normalized.length < this.minTextLengthForFuzzy) {
      const textHash = createHash('md5').update(normalized, 'utf-8').digest('hex');
      const positionHash = `${textHash}-${gridX}-${gridY}`;
      return this.prevPositionHashes.has(positionHash);
    }

    // Search 3x3 grid neighborhood
    const range = this.fuzzyGridRange;
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        const key = `${gridX + dx * this.positionGrid}-${gridY + dy * this.positionGrid}`;
        const prevText = this.prevFrameTexts.get(key);
        if (prevText !== undefined) {
          if (this.isTextSimilar(normalized, prevText)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Check if page content has been stable (similar text content across frames).
   * Uses fuzzy set comparison with Levenshtein similarity instead of exact matching,
   * because OCR produces slightly different text each frame.
   * Returns true when similarity >= 60% for N consecutive frames.
   */
  updateContentStability(texts: TextItem[], threshold?: number, similarityThreshold?: number): boolean {
    const lockThreshold = threshold ?? DEFAULTS.STABILITY_LOCK_THRESHOLD;
    const simThreshold = similarityThreshold ?? DEFAULTS.STABILITY_SIMILARITY_THRESHOLD;

    const currentTexts = new Set(
      texts
        .map((t) => this.normalizeText(t.text))
        .filter((t) => t.length > 0),
    );

    if (this.lastTextSet !== null) {
      // Fuzzy Jaccard-like similarity: count fuzzy matches instead of exact
      let fuzzyIntersection = 0;
      for (const t of currentTexts) {
        // Check if any text in previous set is similar enough
        for (const prev of this.lastTextSet) {
          // Short text: exact match only
          if (t.length < this.minTextLengthForFuzzy) {
            if (t === prev) { fuzzyIntersection++; break; }
          } else {
            if (this.isTextSimilar(t, prev)) { fuzzyIntersection++; break; }
          }
        }
      }
      const maxSet = Math.max(currentTexts.size, this.lastTextSet.size);
      const similarity = maxSet > 0 ? fuzzyIntersection / maxSet : 1;

      if (similarity >= simThreshold) {
        this.stabilityCounter++;
      } else {
        this.stabilityCounter = 0;
      }
      console.log(`[change-detector] Stability: similarity=${similarity.toFixed(2)} fuzzyIntersection=${fuzzyIntersection} maxSet=${maxSet} counter=${this.stabilityCounter}/${lockThreshold}`);
    } else {
      this.stabilityCounter = 0;
    }
    this.lastTextSet = currentTexts;

    const isStable = this.stabilityCounter >= lockThreshold;
    if (isStable && this.stabilityCounter === lockThreshold) {
      console.log(`[change-detector] Content stable after ${lockThreshold} consecutive frames, entering lock mode`);
    }
    return isStable;
  }

  /**
   * Get current stability counter (for diagnostics).
   */
  getStabilityCounter(): number {
    return this.stabilityCounter;
  }

  /**
   * Reset stability tracking (e.g., after unlock).
   */
  resetStability(): void {
    this.stabilityCounter = 0;
    this.lastTextSet = null;
  }

  /**
   * Update fuzzy threshold at runtime (hot-reload).
   */
  updateFuzzyThreshold(threshold: number): void {
    this.fuzzyThreshold = threshold;
    console.log(`[change-detector] Fuzzy threshold updated to ${threshold}`);
  }

  /**
   * Two-layer text deduplication with fuzzy matching:
   *
   * Layer 1 — Fuzzy position matching:
   *   Uses Levenshtein similarity to compare text at similar grid positions.
   *   Handles OCR instability: "Hello World" vs "Hello Wor" (83% similar) → filtered.
   *   Short texts (≤ 3 chars) fall back to exact hash matching.
   *   Searches 3x3 grid neighborhood to absorb position jitter.
   *
   * Layer 2 — Time window (10s):
   *   Same text won't re-translate within the window.
   *   Prevents re-processing during pipeline latency (1-2s translate time).
   */
  filterNewTexts(texts: TextItem[]): TextItem[] {
    const now = Date.now();

    // Clean up expired time window entries
    this.timeWindowEntries = this.timeWindowEntries.filter(
      (entry) => now - entry.timestamp < this.timeWindowMs,
    );

    const newTexts: TextItem[] = [];
    const currentPositionHashes = new Set<string>();
    const currentFrameTexts = new Map<string, string>();

    for (const item of texts) {
      const normalized = this.normalizeText(item.text);
      if (normalized.length === 0) continue;

      // Text content hash (from normalized text)
      const textHash = createHash('md5').update(normalized, 'utf-8').digest('hex');

      // Position-aware hash: text + rounded coordinates
      const [x, y] = item.bbox;
      const gridX = Math.round(x / this.positionGrid) * this.positionGrid;
      const gridY = Math.round(y / this.positionGrid) * this.positionGrid;
      const positionHash = `${textHash}-${gridX}-${gridY}`;

      currentPositionHashes.add(positionHash);
      currentFrameTexts.set(`${gridX}-${gridY}`, normalized);

      // Layer 1: Fuzzy position matching (replaces exact hash check)
      const layer1New = !this.isFuzzyMatchInPrevFrame(normalized, gridX, gridY);

      // Layer 2: Not seen this text content within time window?
      const recentEntry = this.timeWindowEntries.find((e) => e.textHash === textHash);
      const layer2New = !recentEntry || (now - recentEntry.timestamp >= this.timeWindowMs);

      if (layer1New && layer2New) {
        newTexts.push(item);

        // Add to time window tracking
        this.timeWindowEntries.push({ textHash, timestamp: now });
      }
    }

    this.prevPositionHashes = currentPositionHashes;
    this.prevFrameTexts = currentFrameTexts;
    return newTexts;
  }

  reset(): void {
    this.prevPositionHashes.clear();
    this.prevFrameTexts.clear();
    this.timeWindowEntries = [];
    this.stabilityCounter = 0;
    this.lastTextSet = null;
  }
}
