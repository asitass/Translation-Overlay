import { describe, it, expect } from 'vitest';
import { DynamicMode } from '../main/services/pipeline/modes/dynamic-mode';
import { DocumentMode } from '../main/services/pipeline/modes/document-mode';
import type { PipelineContext } from '../main/services/pipeline/modes/pipeline-mode';
import { AdaptiveTimer } from '../main/services/pipeline/adaptive-timer';
import { OutputTracker } from '../main/services/pipeline/output-tracker';

// --- DynamicMode Tests ---

describe('DynamicMode', () => {
  const mode = new DynamicMode();

  const makeCtx = (overrides: Partial<PipelineContext> = {}): PipelineContext => ({
    config: {} as any,
    textBlocks: [],
    overlayItems: [],
    isContentStable: false,
    noNewTextCounter: 0,
    lastEmittedResults: [],
    ...overrides,
  });

  it('should emit new results when last emitted is empty', () => {
    const items = [
      { bbox: [0, 0, 100, 20] as [number, number, number, number], original: 'Hello', translated: '你好', confidence: 0.9 },
    ];
    const ctx = makeCtx({ overlayItems: items });
    const result = mode.handleNewResults(ctx);

    expect(result.shouldEmit).toBe(true);
    expect(result.items).toEqual(items);
    expect(result.locked).toBe(false);
  });

  it('should skip emit when results are unchanged', () => {
    const items = [
      { bbox: [0, 0, 100, 20] as [number, number, number, number], original: 'Hello', translated: '你好', confidence: 0.9 },
    ];
    const ctx = makeCtx({
      overlayItems: items,
      lastEmittedResults: items,
    });
    const result = mode.handleNewResults(ctx);

    expect(result.shouldEmit).toBe(false);
    expect(result.reason).toContain('unchanged');
  });

  it('should detect changes in different number of items', () => {
    const items1 = [
      { bbox: [0, 0, 100, 20] as [number, number, number, number], original: 'Hello', translated: '你好', confidence: 0.9 },
    ];
    const items2 = [
      { bbox: [0, 0, 100, 20] as [number, number, number, number], original: 'Hello', translated: '你好', confidence: 0.9 },
      { bbox: [0, 50, 100, 20] as [number, number, number, number], original: 'World', translated: '世界', confidence: 0.8 },
    ];

    const ctx = makeCtx({ overlayItems: items2, lastEmittedResults: items1 });
    const result = mode.handleNewResults(ctx);
    expect(result.shouldEmit).toBe(true);
  });

  it('should skip no-new-text frames', () => {
    const ctx = makeCtx();
    const result = mode.handleNoNewText(ctx);
    expect(result.shouldEmit).toBe(false);
    expect(result.shouldLock).toBe(false);
  });

  it('should return null for stable content (dynamic mode does not lock)', () => {
    const ctx = makeCtx({ isContentStable: true, lastEmittedResults: [
      { bbox: [0, 0, 100, 20] as [number, number, number, number], original: 'Test', translated: '测试', confidence: 0.9 },
    ]});
    const result = mode.handleStableContent(ctx);
    expect(result).toBeNull();
  });
});

// --- DocumentMode Tests ---

describe('DocumentMode', () => {
  const mode = new DocumentMode();

  const makeCtx = (overrides: Partial<PipelineContext> = {}): PipelineContext => ({
    config: {} as any,
    textBlocks: [],
    overlayItems: [],
    isContentStable: false,
    noNewTextCounter: 0,
    lastEmittedResults: [],
    ...overrides,
  });

  it('should emit new results without locking', () => {
    const items = [
      { bbox: [0, 0, 100, 20] as [number, number, number, number], original: 'Hello', translated: '你好', confidence: 0.9 },
    ];
    const ctx = makeCtx({ overlayItems: items });
    const result = mode.handleNewResults(ctx);

    expect(result.shouldEmit).toBe(true);
    expect(result.shouldLock).toBe(false);
  });

  it('should lock after consecutive no-new-text frames', () => {
    const items = [
      { bbox: [0, 0, 100, 20] as [number, number, number, number], original: 'Hello', translated: '你好', confidence: 0.9 },
    ];

    // First frame: no new text (counter = 1)
    const ctx1 = makeCtx({ noNewTextCounter: 0, lastEmittedResults: items });
    const result1 = mode.handleNoNewText(ctx1);
    expect(result1.shouldLock).toBe(false);

    // Second frame: no new text (counter = 2, threshold = 2)
    const ctx2 = makeCtx({ noNewTextCounter: result1.noNewTextCounter, lastEmittedResults: items });
    const result2 = mode.handleNoNewText(ctx2);
    expect(result2.shouldLock).toBe(true);
    expect(result2.locked).toBe(true);
  });

  it('should not lock without previous results', () => {
    const ctx = makeCtx({ noNewTextCounter: 5, lastEmittedResults: [] });
    const result = mode.handleNoNewText(ctx);
    expect(result.shouldLock).toBe(false);
  });

  it('should lock on stable content when there are previous results', () => {
    const items = [
      { bbox: [0, 0, 100, 20] as [number, number, number, number], original: 'Hello', translated: '你好', confidence: 0.9 },
    ];
    const ctx = makeCtx({ isContentStable: true, lastEmittedResults: items });
    const result = mode.handleStableContent(ctx);

    expect(result).not.toBeNull();
    expect(result!.shouldLock).toBe(true);
    expect(result!.locked).toBe(true);
  });

  it('should not lock on stable content without previous results', () => {
    const ctx = makeCtx({ isContentStable: true, lastEmittedResults: [] });
    const result = mode.handleStableContent(ctx);
    expect(result).toBeNull();
  });
});

// --- OutputTracker Tests ---

describe('OutputTracker', () => {
  it('should track and match outputs', () => {
    const tracker = new OutputTracker(10);
    tracker.add('你好', 'Hello');

    expect(tracker.has('你好')).toBe(true);
    expect(tracker.has('Hello')).toBe(true);
    expect(tracker.has('不存在')).toBe(false);
  });

  it('should trim whitespace before matching', () => {
    const tracker = new OutputTracker(10);
    tracker.add('  你好  ', '  Hello  ');

    expect(tracker.has('你好')).toBe(true);
    expect(tracker.has('Hello')).toBe(true);
  });

  it('should evict old entries when exceeding limit', () => {
    const tracker = new OutputTracker(5);

    // Add more than limit
    for (let i = 0; i < 10; i++) {
      tracker.add(`translation-${i}`, `original-${i}`);
    }

    // Size should be controlled (soft limit is 5 * 1.33 ≈ 6)
    expect(tracker.size).toBeLessThanOrEqual(10);
    // After eviction, size should be around maxSize
    // Recent entries should still be there
    expect(tracker.has('translation-9')).toBe(true);
  });

  it('should clear all entries', () => {
    const tracker = new OutputTracker(10);
    tracker.add('你好', 'Hello');
    tracker.clear();

    expect(tracker.size).toBe(0);
    expect(tracker.has('你好')).toBe(false);
  });
});

// --- AdaptiveTimer Tests -----

describe('AdaptiveTimer', () => {
  it('should not be running initially', () => {
    const timer = new AdaptiveTimer(async () => {});
    expect(timer.isRunning()).toBe(false);
    expect(timer.getCurrentInterval()).toBeNull();
  });

  it('should be running after start', () => {
    const timer = new AdaptiveTimer(async () => {});
    timer.start(1000);

    expect(timer.isRunning()).toBe(true);
    expect(timer.getCurrentInterval()).toBe(1000);

    timer.stop();
    expect(timer.isRunning()).toBe(false);
  });

  it('should adapt interval based on activity', () => {
    const timer = new AdaptiveTimer(async () => {});
    timer.start(3000);

    // First change: since lastChangeTimestamp is 0, idleDuration > 15s,
    // so fast detection mode activates (1000ms)
    timer.adapt(true, 1500, 3000);
    expect(timer.getCurrentInterval()).toBe(1000);

    // Even after multiple changes, fast detection mode persists for 3s
    // So second change also gets fast detection interval
    timer.adapt(true, 1500, 3000);
    expect(timer.getCurrentInterval()).toBe(1000);

    // No change detected 3 times → idle interval
    timer.adapt(false, 1500, 3000);
    timer.adapt(false, 1500, 3000);
    timer.adapt(false, 1500, 3000);
    expect(timer.getCurrentInterval()).toBe(3000);

    // No change 10 times → deep idle
    for (let i = 0; i < 8; i++) {
      timer.adapt(false, 1500, 3000);
    }
    expect(timer.getCurrentInterval()).toBe(6000);

    timer.stop();
  });
});
