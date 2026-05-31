import { describe, it, expect } from 'vitest';
import { groupOcrLines } from '../main/utils/text-grouping';
import type { OcrResult, OcrGroupingConfig } from '../shared/types';

const defaultConfig: OcrGroupingConfig = {
  enabled: true, verticalThresholdRatio: 1.0, horizontalThreshold: 50, requireOverlap: false,
  paragraphGapRatio: 2.0, detectColumns: true,
};

function makeLine(text: string, x: number, y: number, w: number, h: number, confidence = 80): OcrResult {
  return { text, bbox: [x, y, w, h], confidence };
}

describe('groupOcrLines', () => {
  it('returns individual blocks when grouping is disabled', () => {
    const lines = [makeLine('Hello', 100, 100, 50, 20), makeLine('World', 100, 125, 50, 20)];
    const config = { ...defaultConfig, enabled: false };
    const blocks = groupOcrLines(lines, config);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toBe('Hello');
    expect(blocks[1].text).toBe('World');
  });

  it('returns empty array for empty input', () => {
    expect(groupOcrLines([], defaultConfig)).toHaveLength(0);
  });

  it('merges vertically adjacent lines that are close and aligned', () => {
    const lines = [makeLine('Hello', 100, 100, 200, 20), makeLine('World', 100, 128, 200, 20)];
    const blocks = groupOcrLines(lines, defaultConfig);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe('Hello World');
  });

  it('merges lines with spacing up to 1.0x line height', () => {
    // Gap = 118-120 = -2 (overlap) — should merge
    const lines = [makeLine('Line 1', 100, 100, 200, 20), makeLine('Line 2', 100, 118, 200, 20)];
    const blocks = groupOcrLines(lines, defaultConfig);
    expect(blocks).toHaveLength(1);
  });

  it('merges lines with gap equal to line height (1.0x)', () => {
    // Gap = 120-120 = 0, maxGap = 20*1.0 = 20 — should merge (gap=0 <= 20)
    const lines = [makeLine('Line 1', 100, 100, 200, 20), makeLine('Line 2', 100, 120, 200, 20)];
    const blocks = groupOcrLines(lines, defaultConfig);
    expect(blocks).toHaveLength(1);
  });

  it('does not merge lines that are too far apart vertically', () => {
    // Gap = 100+20+25=145-100=45, lineHeight=20, maxGap=20*1.0=20 — gap(45) > maxGap(20)
    const lines = [makeLine('Hello', 100, 100, 200, 20), makeLine('World', 100, 145, 200, 20)];
    expect(groupOcrLines(lines, defaultConfig)).toHaveLength(2);
  });

  it('merges lines with X alignment difference up to 50px', () => {
    // X difference = 145-100 = 45 < 50 — should merge
    const lines = [makeLine('Hello', 100, 100, 200, 20), makeLine('World', 145, 118, 200, 20)];
    const blocks = groupOcrLines(lines, defaultConfig);
    expect(blocks).toHaveLength(1);
  });

  it('does not merge lines with X alignment difference > 50px', () => {
    // X difference = 160-100 = 60 > 50 — should NOT merge
    const lines = [makeLine('Hello', 100, 100, 200, 20), makeLine('World', 160, 118, 200, 20)];
    expect(groupOcrLines(lines, defaultConfig)).toHaveLength(2);
  });

  it('computes union bounding box correctly', () => {
    const lines = [makeLine('Hello', 100, 100, 200, 20), makeLine('World', 100, 128, 200, 20)];
    const blocks = groupOcrLines(lines, defaultConfig);
    expect(blocks[0].bbox).toEqual([100, 100, 200, 48]);
  });

  it('handles three lines in same block', () => {
    const lines = [
      makeLine('Line 1', 100, 100, 200, 20),
      makeLine('Line 2', 100, 128, 200, 20),
      makeLine('Line 3', 100, 156, 200, 20),
    ];
    const blocks = groupOcrLines(lines, defaultConfig);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe('Line 1 Line 2 Line 3');
    expect(blocks[0].lines).toHaveLength(3);
  });

  it('merges lines without horizontal overlap when requireOverlap is false', () => {
    // Lines at different X positions with no horizontal overlap, but within alignment threshold
    const lines = [makeLine('Left', 100, 100, 50, 20), makeLine('Right', 120, 118, 50, 20)];
    const blocks = groupOcrLines(lines, defaultConfig);
    expect(blocks).toHaveLength(1);
  });
});
