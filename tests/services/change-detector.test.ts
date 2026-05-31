import { describe, it, expect } from 'vitest';
import { ChangeDetector } from '../../src/main/services/change-detector';

describe('ChangeDetector', () => {
  it('should detect change when images differ significantly', () => {
    const detector = new ChangeDetector();
    const prev = new Uint8Array(8 * 8 * 4);
    const curr = new Uint8Array(8 * 8 * 4).fill(255);
    expect(detector.hasSignificantChange(curr, prev, 8, 8)).toBe(true);
  });

  it('should not detect change for identical images', () => {
    const detector = new ChangeDetector();
    const img = new Uint8Array(8 * 8 * 4).fill(128);
    expect(detector.hasSignificantChange(img, img, 8, 8)).toBe(false);
  });

  it('should not detect change for minor differences', () => {
    const detector = new ChangeDetector();
    const prev = new Uint8Array(8 * 8 * 4).fill(100);
    const curr = new Uint8Array(8 * 8 * 4).fill(110);
    expect(detector.hasSignificantChange(curr, prev, 8, 8)).toBe(false);
  });

  it('should detect change for different sized images', () => {
    const detector = new ChangeDetector();
    const a = new Uint8Array(8 * 8 * 4);
    const b = new Uint8Array(10 * 10 * 4);
    expect(detector.hasSignificantChange(b, a, 10, 8)).toBe(true);
  });

  it('should filter new texts correctly', () => {
    const detector = new ChangeDetector();
    const texts = [
      { text: 'hello', bbox: [0, 0, 50, 20] as [number, number, number, number] },
      { text: 'world', bbox: [0, 30, 50, 20] as [number, number, number, number] },
    ];
    const new1 = detector.filterNewTexts(texts);
    expect(new1).toHaveLength(2);
    const new2 = detector.filterNewTexts(texts);
    expect(new2).toHaveLength(0);
    const texts2 = [
      { text: 'hello', bbox: [0, 0, 50, 20] as [number, number, number, number] },
      { text: 'changed', bbox: [0, 30, 50, 20] as [number, number, number, number] },
    ];
    const new3 = detector.filterNewTexts(texts2);
    expect(new3).toHaveLength(1);
    expect(new3[0].text).toBe('changed');
  });

  it('should fast-reject identical buffers with Buffer.compare', () => {
    const detector = new ChangeDetector();
    const img = new Uint8Array(100 * 100 * 4).fill(128);
    // Same reference should be instant
    expect(detector.hasSignificantChange(img, img, 100, 100)).toBe(false);
  });

  it('should detect change with sampled comparison and early termination', () => {
    const detector = new ChangeDetector();
    const prev = new Uint8Array(100 * 100 * 4).fill(100);
    const curr = new Uint8Array(100 * 100 * 4).fill(100);
    // Change 10% of pixels significantly
    for (let i = 0; i < curr.length; i += 4) {
      if ((i / 4) % 10 === 0) {
        curr[i] = 200;     // R channel large diff
        curr[i + 1] = 200; // G channel large diff
        curr[i + 2] = 200; // B channel large diff
      }
    }
    expect(detector.hasSignificantChange(curr, prev, 100, 100)).toBe(true);
  });

  it('should not detect change with minor differences under threshold', () => {
    const detector = new ChangeDetector();
    const prev = new Uint8Array(100 * 100 * 4).fill(100);
    const curr = new Uint8Array(100 * 100 * 4).fill(115); // 15 diff < 30 threshold
    expect(detector.hasSignificantChange(curr, prev, 100, 100)).toBe(false);
  });
});
