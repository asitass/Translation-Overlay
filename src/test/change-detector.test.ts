import { describe, it, expect, beforeEach } from 'vitest';
import { ChangeDetector } from '../main/services/change-detector';
import { DEFAULTS } from '../shared/constants';

describe('ChangeDetector - Fuzzy Matching', () => {
  let detector: ChangeDetector;

  beforeEach(() => {
    detector = new ChangeDetector(
      DEFAULTS.CHANGE_DETECTOR_THRESHOLD,
      DEFAULTS.CHANGE_DETECTOR_BLOCK_SIZE,
      DEFAULTS.CHANGE_DETECTOR_TIME_WINDOW_MS,
      DEFAULTS.CHANGE_DETECTOR_POSITION_GRID,
      0.85, // fuzzyThreshold
    );
  });

  const makeText = (text: string, x: number, y: number) => ({
    text,
    bbox: [x, y, 100, 20] as [number, number, number, number],
  });

  describe('filterNewTexts - fuzzy matching', () => {
    it('should filter identical text at same position', () => {
      const frame1 = [makeText('Hello World', 100, 200)];
      detector.filterNewTexts(frame1);

      const frame2 = [makeText('Hello World', 100, 200)];
      const result = detector.filterNewTexts(frame2);

      expect(result).toHaveLength(0);
    });

    it('should filter truncated text (OCR truncation)', () => {
      const frame1 = [makeText('Hello World', 100, 200)];
      detector.filterNewTexts(frame1);

      const frame2 = [makeText('Hello Wor', 100, 200)];
      const result = detector.filterNewTexts(frame2);

      // "Hello World" vs "Hello Wor" ≈ 90% similar → filtered
      expect(result).toHaveLength(0);
    });

    it('should filter text with punctuation noise', () => {
      const frame1 = [makeText('Hello World', 100, 200)];
      detector.filterNewTexts(frame1);

      const frame2 = [makeText('Hello World!', 100, 200)];
      const result = detector.filterNewTexts(frame2);

      // "helloworld" vs "helloworld" after normalization → filtered
      expect(result).toHaveLength(0);
    });

    it('should NOT filter completely different text', () => {
      const frame1 = [makeText('Hello World', 100, 200)];
      detector.filterNewTexts(frame1);

      const frame2 = [makeText('Settings Menu', 100, 200)];
      const result = detector.filterNewTexts(frame2);

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('Settings Menu');
    });

    it('should use exact match for short text (≤3 chars)', () => {
      const frame1 = [makeText('Hi', 100, 200)];
      detector.filterNewTexts(frame1);

      const frame2 = [makeText('Ho', 100, 200)];
      const result = detector.filterNewTexts(frame2);

      // Short text: exact match, "hi" ≠ "ho" → not filtered
      expect(result).toHaveLength(1);
    });

    it('should filter text with slight position jitter (within grid)', () => {
      const frame1 = [makeText('Hello World', 100, 200)];
      detector.filterNewTexts(frame1);

      const frame2 = [makeText('Hello World', 105, 203)]; // 5px offset → same 10px grid
      const result = detector.filterNewTexts(frame2);

      expect(result).toHaveLength(0);
    });

    it('should NOT filter text at distant position (different grid)', () => {
      const frame1 = [makeText('Hello World', 100, 200)];
      detector.filterNewTexts(frame1);

      // Use a DIFFERENT text at distant position (same text is caught by Layer 2 time window)
      const frame2 = [makeText('Goodbye World', 200, 400)]; // different text, different position
      const result = detector.filterNewTexts(frame2);

      expect(result).toHaveLength(1);
    });

    it('should filter truncated text at slightly different position (within neighborhood)', () => {
      const frame1 = [makeText('Electron Configuration', 100, 200)];
      detector.filterNewTexts(frame1);

      // OCR truncates and shifts position by a few pixels
      const frame2 = [makeText('Electron Configurat', 103, 198)];
      const result = detector.filterNewTexts(frame2);

      // "electronconfiguration" vs "electronconfigurat" ≈ 95% similar
      // Position within ±10px grid neighborhood
      expect(result).toHaveLength(0);
    });

    it('should handle multiple text blocks across frames', () => {
      const frame1 = [
        makeText('Hello World', 100, 200),
        makeText('Configuration', 300, 400),
      ];
      detector.filterNewTexts(frame1);

      const frame2 = [
        makeText('Hello World', 100, 200),      // same → filtered (exact match)
        makeText('Configuration', 300, 400),     // same → filtered (exact match)
        makeText('New Button', 500, 600),        // new → kept
      ];
      const result = detector.filterNewTexts(frame2);

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('New Button');
    });

    it('should skip empty text', () => {
      const frame1 = [makeText('', 100, 200)];
      const result = detector.filterNewTexts(frame1);

      expect(result).toHaveLength(0);
    });
  });

  describe('updateContentStability - fuzzy matching', () => {
    it('should detect stability with OCR truncation variation', () => {
      const threshold = DEFAULTS.STABILITY_LOCK_THRESHOLD; // 3

      // Frame 1: establish baseline
      const texts1 = [makeText('Hello World', 100, 200), makeText('Settings', 300, 400)];
      detector.updateContentStability(texts1);

      // Frames 2+: slight truncation variations (similar enough via prefix match)
      let lastStable = false;
      for (let i = 0; i < threshold + 2; i++) {
        const texts = [makeText('Hello Wor', 100, 200), makeText('Settings', 300, 400)];
        lastStable = detector.updateContentStability(texts);
      }

      expect(lastStable).toBe(true);
    });

    it('should reset stability on major content change', () => {
      const texts1 = [makeText('Hello World', 100, 200)];
      detector.updateContentStability(texts1);

      // Similar frames
      for (let i = 0; i < 2; i++) {
        detector.updateContentStability([makeText('Hello Wor', 100, 200)]);
      }

      // Completely different content
      const stable = detector.updateContentStability([
        makeText('Completely Different', 500, 600),
        makeText('New Text', 700, 800),
      ]);
      expect(stable).toBe(false);
    });
  });

  describe('reset', () => {
    it('should clear all tracking state', () => {
      const frame1 = [makeText('Hello', 100, 200)];
      detector.filterNewTexts(frame1);
      detector.updateContentStability(frame1);

      detector.reset();

      // After reset, same text should be treated as new
      const frame2 = [makeText('Hello', 100, 200)];
      const result = detector.filterNewTexts(frame2);
      expect(result).toHaveLength(1);
    });
  });
});
